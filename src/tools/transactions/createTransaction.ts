import { z } from "zod";
import * as ynab from "ynab";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const createTransaction = defineTool({
  name: "ynab_create_transaction",
  title: "Create Transaction",
  description:
    "Creates a new transaction in your plan. Either payeeId or payeeName must be provided in addition to the other required fields.",
  inputSchema: {
    planId: planIdParam,
    accountId: z.string().describe("The id of the account to create the transaction in"),
    date: z.string().describe("The date of the transaction in ISO format (e.g. 2024-03-24)"),
    amount: z.number().describe("The amount in dollars (e.g. 10.99)"),
    payeeId: z.string().optional().describe("The id of the payee (optional if payeeName is provided)"),
    payeeName: z.string().optional().describe("The name of the payee (optional if payeeId is provided)"),
    categoryId: z.string().optional().describe("The category id for the transaction (optional)"),
    memo: z.string().optional().describe("A memo/note for the transaction (optional)"),
    cleared: z.boolean().optional().describe("Whether the transaction is cleared (optional, defaults to false)"),
    approved: z.boolean().optional().describe("Whether the transaction is approved (optional, defaults to false)"),
    flagColor: z.string().optional().describe("The transaction flag color (red, orange, yellow, green, blue, purple) (optional)"),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  async handler(input, ctx) {
    if (!input.payeeId && !input.payeeName) {
      throw new Error("Either payeeId or payeeName must be provided");
    }
    const response = await ctx.api.transactions.createTransaction(ctx.planId(input.planId), {
      transaction: {
        account_id: input.accountId,
        date: input.date,
        amount: Math.round(input.amount * 1000),
        payee_id: input.payeeId,
        payee_name: input.payeeName,
        category_id: input.categoryId,
        memo: input.memo,
        cleared: input.cleared ? ynab.TransactionClearedStatus.Cleared : ynab.TransactionClearedStatus.Uncleared,
        approved: input.approved ?? false,
        flag_color: input.flagColor as ynab.TransactionFlagColor,
      },
    });
    const transaction = response.data.transaction;
    if (!transaction) throw new Error("Failed to create transaction - no transaction data returned");
    return { success: true, transactionId: transaction.id, message: "Transaction created successfully" };
  },
});
