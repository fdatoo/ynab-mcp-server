import { z } from "zod";
import * as ynab from "ynab";
import { defineTool } from "../defineTool.js";
import { accountRef, categoryRef, clearedParam, dateParam, payeeRef, planIdParam } from "../common.js";
import { formatHybridTransaction, formatTransaction } from "../format.js";
import { fromMilliunits, toMilliunits } from "../../ynab/money.js";
import { isTransfer } from "../system.js";

export const DEFAULT_WINDOW_DAYS = 90;

function daysAgo(days: number, today = new Date()): string {
  const date = new Date(today);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Payee and memo, including each split line's, so a memo on one line of a split is findable. */
function searchableText(row: { payee: string | null; memo: string | null; subtransactions?: Array<{ payee: string | null; memo: string | null }> }) {
  const parts = [row.payee, row.memo, ...(row.subtransactions ?? []).flatMap((sub) => [sub.payee, sub.memo])];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export const searchTransactions = defineTool({
  name: "ynab_search_transactions",
  title: "Search Transactions",
  description:
    "Finds transactions, newest first. Filter by date range, account, category, payee, status (unapproved or uncategorized), " +
    "text in the payee or memo (split lines included), amount range, and cleared status. Without sinceDate only the last 90 days are searched. " +
    "Amounts are signed: negative is an outflow. Filtering by category returns the matching lines of split transactions too.",
  inputSchema: {
    planId: planIdParam,
    sinceDate: dateParam.optional().describe("Earliest date, inclusive (YYYY-MM-DD). Defaults to 90 days ago."),
    untilDate: dateParam.optional().describe("Latest date, inclusive (YYYY-MM-DD)"),
    account: accountRef.optional(),
    category: categoryRef.optional(),
    payee: payeeRef.optional(),
    status: z.enum(["unapproved", "uncategorized"]).optional().describe("Only unapproved, or only uncategorized, transactions"),
    text: z.string().min(1).optional().describe("Case-insensitive text to find in the payee name or memo, including split lines"),
    minAmount: z.number().nonnegative().optional().describe("Smallest absolute amount, in currency units"),
    maxAmount: z.number().nonnegative().optional().describe("Largest absolute amount, in currency units"),
    direction: z.enum(["outflow", "inflow"]).optional().describe("Only outflows or only inflows"),
    cleared: clearedParam.optional().describe("Only transactions with this cleared status"),
    sort: z.enum(["newest", "oldest"]).default("newest"),
    limit: z.number().int().min(1).max(500).default(50),
    offset: z.number().int().min(0).default(0).describe("Skip this many matches, for paging"),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const since = input.sinceDate ?? daysAgo(DEFAULT_WINDOW_DAYS);
    const until = input.untilDate;
    const type = input.status as ynab.GetTransactionsTypeEnum | undefined;

    const [account, category, payee] = await Promise.all([
      input.account ? ctx.lookup.resolveAccount(planId, input.account) : undefined,
      input.category ? ctx.lookup.resolveCategory(planId, input.category) : undefined,
      input.payee ? ctx.lookup.resolvePayee(planId, input.payee) : undefined,
    ]);

    // One request, to the narrowest endpoint; any other entity filters apply locally.
    const t = ctx.api.transactions;
    type Row = ReturnType<typeof formatTransaction> | ReturnType<typeof formatHybridTransaction>;
    let rows: Array<{ row: Row; accountId: string; payeeId?: string | null; categoryId?: string | null; milliunits: number }>;
    if (category) {
      const { data } = await t.getTransactionsByCategory(planId, category.id, since, until, type as ynab.GetTransactionsByCategoryTypeEnum);
      rows = data.transactions
        .filter((txn) => !txn.deleted)
        .map((txn) => ({ row: formatHybridTransaction(txn, currency), accountId: txn.account_id, payeeId: txn.payee_id, categoryId: txn.category_id, milliunits: txn.amount }));
    } else {
      const { data } = account
        ? await t.getTransactionsByAccount(planId, account.id, since, until, type as ynab.GetTransactionsByAccountTypeEnum)
        : payee
          ? await t.getTransactionsByPayee(planId, payee.id, since, until, type as ynab.GetTransactionsByPayeeTypeEnum)
          : await t.getTransactions(planId, since, until, type);
      rows = data.transactions
        .filter((txn) => !txn.deleted)
        .map((txn) => ({ row: formatTransaction(txn as ynab.TransactionDetail, currency), accountId: txn.account_id, payeeId: txn.payee_id, categoryId: txn.category_id, milliunits: txn.amount }));
    }

    // type=uncategorized also returns transfer legs between the user's own accounts.
    const transferPayees =
      input.status === "uncategorized"
        ? new Set((await ctx.lookup.payees(planId)).filter((p) => p.transfer_account_id).map((p) => p.id))
        : undefined;
    const text = input.text?.toLowerCase();
    const min = input.minAmount !== undefined ? toMilliunits(input.minAmount, currency) : undefined;
    const max = input.maxAmount !== undefined ? toMilliunits(input.maxAmount, currency) : undefined;
    const matches = rows.filter(({ row, accountId, payeeId, milliunits }) => {
      if (transferPayees && isTransfer({ transfer_account_id: "transfer_account_id" in row ? row.transfer_account_id : undefined, payee_id: payeeId ?? undefined }, transferPayees)) return false;
      if (account && accountId !== account.id) return false;
      if (payee && payeeId !== payee.id) return false;
      if (text && !searchableText(row).includes(text)) return false;
      if (min !== undefined && Math.abs(milliunits) < min) return false;
      if (max !== undefined && Math.abs(milliunits) > max) return false;
      if (input.direction === "outflow" && milliunits >= 0) return false;
      if (input.direction === "inflow" && milliunits <= 0) return false;
      if (input.cleared && row.cleared !== input.cleared) return false;
      return true;
    });

    // The API returns oldest first; ties keep API order either way.
    if (input.sort === "newest") matches.reverse();
    const page = matches.slice(input.offset, input.offset + input.limit).map(({ row }) => row);

    return {
      currency: currency.iso_code,
      searched: { since, until: until ?? null },
      total_matching: matches.length,
      offset: input.offset,
      returned: page.length,
      ...(input.offset + page.length < matches.length ? { next_offset: input.offset + page.length } : {}),
      net_amount: fromMilliunits(matches.reduce((sum, m) => sum + m.milliunits, 0), currency),
      transactions: page,
    };
  },
});
