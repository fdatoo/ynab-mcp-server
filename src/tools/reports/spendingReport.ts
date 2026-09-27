import { z } from "zod";
import type * as ynab from "ynab";
import { defineTool } from "../defineTool.js";
import { accountRef, dateParam, planIdParam } from "../common.js";
import { fromMilliunits } from "../../ynab/money.js";

interface Line {
  amount: number;
  categoryId?: string | null;
  categoryName?: string | null;
  payeeName?: string | null;
  isTransfer: boolean;
}

/** One line per split part, so each part counts toward its own category. */
function lines(txn: ynab.TransactionDetail): Line[] {
  const live = txn.subtransactions?.filter((sub) => !sub.deleted) ?? [];
  if (live.length === 0) {
    return [{ amount: txn.amount, categoryId: txn.category_id, categoryName: txn.category_name, payeeName: txn.payee_name, isTransfer: !!txn.transfer_account_id }];
  }
  return live.map((sub) => ({
    amount: sub.amount,
    categoryId: sub.category_id,
    categoryName: sub.category_name,
    payeeName: sub.payee_name ?? txn.payee_name,
    isTransfer: !!sub.transfer_account_id,
  }));
}

export const spendingReport = defineTool({
  name: "ynab_spending_report",
  title: "Spending Report",
  description:
    "Totals transactions over a date range by category, category group, or payee, largest first. Split transactions count toward " +
    "each line's own category. Transfers between accounts are left out unless includeTransfers is set. By default reports outflows " +
    "(spending) as positive totals; 'inflows' reports income, 'net' sums both with outflows negative. Defaults to the current month so far.",
  inputSchema: {
    planId: planIdParam,
    sinceDate: dateParam.optional().describe("Start date, inclusive. Defaults to the first of the current month."),
    untilDate: dateParam.optional().describe("End date, inclusive"),
    groupBy: z.enum(["category", "group", "payee"]).default("category"),
    measure: z.enum(["outflows", "inflows", "net"]).default("outflows"),
    account: accountRef.optional().describe("Only this account"),
    includeTransfers: z.boolean().default(false),
    top: z.number().int().min(1).max(200).default(25).describe("How many rows to return; the rest are summed as 'Other'"),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const since = input.sinceDate ?? `${new Date().toISOString().slice(0, 7)}-01`;
    const account = input.account ? await ctx.lookup.resolveAccount(planId, input.account) : undefined;
    const t = ctx.api.transactions;
    const { data } = account
      ? await t.getTransactionsByAccount(planId, account.id, since, input.untilDate)
      : await t.getTransactions(planId, since, input.untilDate);

    const groupOf = new Map((await ctx.lookup.categories(planId)).map((c) => [c.id, c.category_group_name]));
    const keyOf = (line: Line) => {
      if (input.groupBy === "payee") return line.payeeName ?? "(no payee)";
      if (!line.categoryId) return line.isTransfer ? "(transfer)" : "(uncategorized)";
      return input.groupBy === "group" ? (groupOf.get(line.categoryId) ?? "(unknown group)") : (line.categoryName ?? "(unknown category)");
    };
    const counts = (line: Line) =>
      input.measure === "net" || (input.measure === "outflows" ? line.amount < 0 : line.amount > 0);
    // Outflows read better as positive spending totals; net keeps the sign.
    const value = (amount: number) => (input.measure === "outflows" ? -amount : amount);

    const totals = new Map<string, { total: number; count: number }>();
    let transactionCount = 0;
    for (const txn of data.transactions as ynab.TransactionDetail[]) {
      if (txn.deleted) continue;
      let counted = false;
      for (const line of lines(txn)) {
        if (line.isTransfer && !input.includeTransfers) continue;
        if (!counts(line)) continue;
        const row = totals.get(keyOf(line)) ?? { total: 0, count: 0 };
        row.total += value(line.amount);
        row.count += 1;
        totals.set(keyOf(line), row);
        counted = true;
      }
      if (counted) transactionCount += 1;
    }

    const sorted = [...totals].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total));
    const grandTotal = sorted.reduce((sum, [, row]) => sum + row.total, 0);
    const shown = sorted.slice(0, input.top);
    const rest = sorted.slice(input.top);
    const share = (ms: number) => (grandTotal === 0 ? 0 : Math.round((ms / grandTotal) * 1000) / 10);
    const rows = shown.map(([name, row]) => ({ name, total: fromMilliunits(row.total, currency), lines: row.count, percent: share(row.total) }));
    if (rest.length > 0) {
      const other = rest.reduce((sum, [, row]) => sum + row.total, 0);
      rows.push({ name: `Other (${rest.length})`, total: fromMilliunits(other, currency), lines: rest.reduce((n, [, row]) => n + row.count, 0), percent: share(other) });
    }

    return {
      currency: currency.iso_code,
      period: { since, until: input.untilDate ?? null },
      measure: input.measure,
      group_by: input.groupBy,
      ...(account ? { account: account.name } : {}),
      total: fromMilliunits(grandTotal, currency),
      transactions: transactionCount,
      rows,
    };
  },
});
