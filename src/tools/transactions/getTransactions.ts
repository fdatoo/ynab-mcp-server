import { z } from "zod";
import * as ynab from "ynab";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

type TypeFilter = "all" | "uncategorized" | "unapproved";

function toApiType(type?: TypeFilter): ynab.GetTransactionsTypeEnum | undefined {
  switch (type) {
    case "uncategorized":
      return ynab.GetTransactionsTypeEnum.Uncategorized;
    case "unapproved":
      return ynab.GetTransactionsTypeEnum.Unapproved;
    default:
      return undefined;
  }
}

export const getTransactions = defineTool({
  name: "ynab_get_transactions",
  title: "Get Transactions",
  description:
    "Gets transactions from a plan with optional filters. Can filter by date range, account, category, payee, or approval status.",
  inputSchema: {
    planId: planIdParam,
    sinceDate: z.string().optional().describe("Only return transactions on or after this date (ISO format: 2024-01-01)"),
    type: z.enum(["all", "uncategorized", "unapproved"]).optional().describe("Filter by transaction type. Defaults to 'all'."),
    accountId: z.string().optional().describe("Filter to only transactions in this account"),
    categoryId: z.string().optional().describe("Filter to only transactions in this category"),
    payeeId: z.string().optional().describe("Filter to only transactions with this payee"),
    limit: z.number().optional().describe("Maximum number of transactions to return (default: 100)"),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const type = toApiType(input.type);
    const limit = input.limit || 100;

    // The by-account/category/payee type enums share values with GetTransactionsTypeEnum.
    const rawTransactions = input.accountId
      ? (await ctx.api.transactions.getTransactionsByAccount(planId, input.accountId, input.sinceDate, undefined, type as ynab.GetTransactionsByAccountTypeEnum)).data.transactions
      : input.categoryId
        ? (await ctx.api.transactions.getTransactionsByCategory(planId, input.categoryId, input.sinceDate, undefined, type as ynab.GetTransactionsByCategoryTypeEnum)).data.transactions
        : input.payeeId
          ? (await ctx.api.transactions.getTransactionsByPayee(planId, input.payeeId, input.sinceDate, undefined, type as ynab.GetTransactionsByPayeeTypeEnum)).data.transactions
          : (await ctx.api.transactions.getTransactions(planId, input.sinceDate, undefined, type)).data.transactions;

    const live = rawTransactions.filter((txn) => !txn.deleted);
    const transactions = live.slice(0, limit).map((txn) => ({
      id: txn.id,
      date: txn.date,
      amount: (txn.amount / 1000).toFixed(2),
      memo: txn.memo,
      approved: txn.approved,
      cleared: txn.cleared,
      account_name: txn.account_name,
      payee_name: txn.payee_name,
      category_name: txn.category_name,
      flag_color: txn.flag_color,
      transfer_account_id: txn.transfer_account_id,
    }));
    return { transactions, transaction_count: transactions.length, total_available: live.length };
  },
});
