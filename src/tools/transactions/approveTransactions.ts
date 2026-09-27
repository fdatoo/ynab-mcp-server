import { z } from "zod";
import * as ynab from "ynab";
import { defineTool } from "../defineTool.js";
import { accountRef, dateParam, planIdParam } from "../common.js";
import { fromMilliunits, type Currency } from "../../ynab/money.js";

/** A smaller view than formatTransaction: enough to confirm which transactions changed, no more. */
function compact(txn: ynab.TransactionDetail, currency: Currency) {
  return { id: txn.id, date: txn.date, amount: fromMilliunits(txn.amount, currency), payee: txn.payee_name ?? null, approved: txn.approved };
}

export const approveTransactions = defineTool({
  name: "ynab_approve_transactions",
  title: "Approve Transactions",
  description:
    "Approves or unapproves transactions, either by id or by a filter (account, sinceDate, untilDate) that selects every currently " +
    "unapproved transaction. Give either ids or a filter, not both. approved defaults to true; set it to false to unapprove, which " +
    "is only allowed with ids. Use dryRun to preview what would change without writing.",
  inputSchema: {
    planId: planIdParam,
    ids: z.array(z.string()).min(1).max(500).optional().describe("Transaction ids to approve or unapprove"),
    account: accountRef.optional().describe("With sinceDate/untilDate, limit the filter to this account"),
    sinceDate: dateParam.optional().describe("Filter: earliest date, inclusive"),
    untilDate: dateParam.optional().describe("Filter: latest date, inclusive"),
    approved: z.boolean().default(true).describe("false unapproves instead; only valid together with ids"),
    dryRun: z.boolean().default(false).describe("Report what would change without writing"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const hasFilter = input.account !== undefined || input.sinceDate !== undefined || input.untilDate !== undefined;

    if (input.ids && hasFilter) throw new Error("give either ids or a filter (account, sinceDate, untilDate), not both");
    if (!input.ids && !hasFilter) throw new Error("give ids, or a filter (account, sinceDate, or untilDate)");
    if (!input.approved && !input.ids) throw new Error("approved: false is only valid together with ids");

    let ids: string[];
    let preview: ynab.TransactionDetail[] | undefined;

    if (input.ids) {
      ids = input.ids;
      if (input.dryRun) {
        // There is no bulk get by id, and one request per id would spend the
        // hourly rate limit, so the preview reads the transaction list once.
        const { data } = await ctx.api.transactions.getTransactions(
          planId,
          undefined,
          undefined,
          input.approved ? ynab.GetTransactionsTypeEnum.Unapproved : undefined
        );
        const wanted = new Set(ids);
        preview = (data.transactions as ynab.TransactionDetail[]).filter((txn) => !txn.deleted && wanted.has(txn.id));
      }
    } else {
      const account = input.account ? await ctx.lookup.resolveAccount(planId, input.account) : undefined;
      const { data } = account
        ? await ctx.api.transactions.getTransactionsByAccount(
            planId,
            account.id,
            input.sinceDate,
            input.untilDate,
            ynab.GetTransactionsByAccountTypeEnum.Unapproved
          )
        : await ctx.api.transactions.getTransactions(planId, input.sinceDate, input.untilDate, ynab.GetTransactionsTypeEnum.Unapproved);
      const unapproved = (data.transactions as ynab.TransactionDetail[]).filter((txn) => !txn.deleted);
      ids = unapproved.map((txn) => txn.id);
      if (input.dryRun) preview = unapproved;
    }

    if (ids.length === 0) {
      return { currency: currency.iso_code, ...(input.dryRun ? { dry_run: true } : {}), updated_count: 0, transactions: [] };
    }

    if (input.dryRun) {
      return {
        currency: currency.iso_code,
        dry_run: true,
        would_update_count: preview!.length,
        transactions: preview!.map((txn) => compact(txn, currency)),
        ...(input.ids && preview!.length < ids.length
          ? { not_found: ids.filter((id) => !preview!.some((txn) => txn.id === id)), note: "Not found, deleted, or already in the requested state." }
          : {}),
      };
    }

    const { data } = await ctx.api.transactions.updateTransactions(planId, {
      transactions: ids.map((id) => ({ id, approved: input.approved })),
    });
    const updated = data.transactions ?? [];
    const updatedIds = new Set(updated.map((txn) => txn.id));
    const notUpdated = ids.filter((id) => !updatedIds.has(id));

    return {
      currency: currency.iso_code,
      updated_count: updated.length,
      transactions: updated.map((txn) => compact(txn, currency)),
      ...(notUpdated.length > 0 ? { not_updated: notUpdated } : {}),
    };
  },
});
