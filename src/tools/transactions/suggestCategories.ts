import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { accountRef, dateParam, planIdParam } from "../common.js";
import { fromMilliunits } from "../../ynab/money.js";
import { isBalanceEntry, isCreditCardPaymentCategory, isTransfer } from "../system.js";

function daysAgo(days: number, today = new Date()): string {
  const date = new Date(today);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function monthsAgo(months: number, today = new Date()): string {
  const date = new Date(today);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

type Direction = "inflow" | "outflow";

function directionOf(amount: number): Direction {
  return amount >= 0 ? "inflow" : "outflow";
}

export const suggestCategories = defineTool({
  name: "ynab_suggest_categories",
  title: "Suggest Categories",
  description:
    "Suggests a category for uncategorized transactions, learned from how the same payee has been categorized before in this plan. " +
    "Read-only: makes no changes, and calls no third party. Confidence is 'high', 'medium' or 'low' depending on how consistent the " +
    "payee's history is; confirm a low-confidence suggestion with the user before applying it. Apply with ynab_update_transactions, " +
    "passing ifUncategorized: true so a transaction categorized by someone else in the meantime is skipped instead of overwritten.",
  inputSchema: {
    planId: planIdParam,
    sinceDate: dateParam.optional().describe("Earliest date of uncategorized transactions to consider (YYYY-MM-DD). Defaults to 30 days ago."),
    account: accountRef.optional().describe("Only suggest for uncategorized transactions in this account"),
    includeUnapproved: z.boolean().default(true).describe("Consider unapproved uncategorized transactions as candidates too, not only approved ones"),
    historyMonths: z.number().int().min(1).max(24).default(12).describe("How many months of history to learn each payee's category from"),
    limit: z.number().int().min(1).max(200).default(50).describe("Maximum number of suggestions to return"),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const today = new Date();
    const since = input.sinceDate ?? daysAgo(30, today);
    // The earlier of "historyMonths ago" and sinceDate, so a wide sinceDate
    // never gets less history than it would need to cover its own window.
    const historyStart = [monthsAgo(input.historyMonths, today), since].sort()[0];

    // Resolved locally rather than via getTransactionsByAccount: that endpoint
    // would also narrow the history half of this same request to one account,
    // which is not what "account" is for here.
    const account = input.account ? await ctx.lookup.resolveAccount(planId, input.account) : undefined;
    const [payees, categories] = await Promise.all([ctx.lookup.payees(planId), ctx.lookup.categories(planId)]);
    const transferPayeeIds = new Set(payees.filter((payee) => payee.transfer_account_id).map((payee) => payee.id));
    const categoriesById = new Map(categories.map((category) => [category.id, category]));

    // The one and only transactions request: both the candidates and the
    // history they are matched against come out of this single response.
    const { data } = await ctx.api.transactions.getTransactions(planId, historyStart);
    const rows = data.transactions.filter((txn) => !txn.deleted);

    // Per payee and direction (an inflow means something different from an
    // outflow from the same payee), how often each category was used.
    const history = new Map<string, Map<string, number>>();
    for (const txn of rows) {
      if (!txn.category_id || !txn.payee_id) continue;
      if (txn.subtransactions?.length) continue;
      if (isTransfer(txn, transferPayeeIds) || isBalanceEntry(txn.payee_name)) continue;

      const category = categoriesById.get(txn.category_id);
      // A deleted or internal category says nothing useful about how to
      // categorize ordinary spending, and a credit-card-payment category is
      // never a real answer here (the API silently stores it as Uncategorized).
      if (!category || category.internal || isCreditCardPaymentCategory(category)) continue;

      const key = `${txn.payee_id}|${directionOf(txn.amount)}`;
      const counts = history.get(key) ?? new Map<string, number>();
      counts.set(txn.category_id, (counts.get(txn.category_id) ?? 0) + 1);
      history.set(key, counts);
    }

    const candidates = rows.filter((txn) => {
      if (txn.date < since) return false;
      if (txn.category_id) return false;
      if (txn.subtransactions?.length) return false;
      if (isTransfer(txn, transferPayeeIds) || isBalanceEntry(txn.payee_name)) return false;
      if (txn.cleared === "reconciled") return false;
      if (!input.includeUnapproved && !txn.approved) return false;
      if (account && txn.account_id !== account.id) return false;
      return true;
    });

    interface Suggestion {
      transaction: { id: string; date: string; amount: number; payee: string | null; account: string; memo: string | null };
      suggestion: { category_id: string; category: string; confidence: "high" | "medium" | "low"; based_on: { matches: number; total: number } };
    }

    const suggestions: Suggestion[] = [];
    const noHistoryCounts = new Map<string, number>();

    for (const txn of candidates) {
      const key = txn.payee_id ? `${txn.payee_id}|${directionOf(txn.amount)}` : undefined;
      const counts = key ? history.get(key) : undefined;
      const total = counts ? [...counts.values()].reduce((sum, count) => sum + count, 0) : 0;

      if (!counts || total === 0) {
        const label = txn.payee_name ?? "(no payee)";
        noHistoryCounts.set(label, (noHistoryCounts.get(label) ?? 0) + 1);
        continue;
      }

      let bestCategoryId = "";
      let bestCount = 0;
      for (const [categoryId, count] of counts) {
        if (count > bestCount) {
          bestCategoryId = categoryId;
          bestCount = count;
        }
      }
      const category = categoriesById.get(bestCategoryId)!;
      const ratio = bestCount / total;
      const confidence = total >= 3 && bestCount === total ? "high" : ratio >= 0.6 && total >= 2 ? "medium" : "low";

      suggestions.push({
        transaction: {
          id: txn.id,
          date: txn.date,
          amount: fromMilliunits(txn.amount, currency),
          payee: txn.payee_name ?? null,
          account: txn.account_name,
          memo: txn.memo ?? null,
        },
        suggestion: {
          category_id: category.id,
          category: `${category.category_group_name}: ${category.name}`,
          confidence,
          based_on: { matches: bestCount, total },
        },
      });
    }

    // rows (and so candidates) came back oldest first; a plain reverse gives newest first.
    suggestions.reverse();
    const page = suggestions.slice(0, input.limit);
    const noHistory = [...noHistoryCounts.entries()].map(([payee, count]) => ({ payee, count }));

    return {
      currency: currency.iso_code,
      window: { since, historyStart, historyMonths: input.historyMonths },
      total_candidates: candidates.length,
      suggested: suggestions.length,
      returned: page.length,
      suggestions: page,
      no_history: noHistory,
    };
  },
});
