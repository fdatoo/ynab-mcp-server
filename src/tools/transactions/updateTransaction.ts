import { z } from "zod";
import * as ynab from "ynab";
import { defineTool } from "../defineTool.js";
import { clearedParam, flagColorParam, planIdParam } from "../common.js";

const clearedStatus: Record<z.infer<typeof clearedParam>, ynab.TransactionClearedStatus> = {
  cleared: ynab.TransactionClearedStatus.Cleared,
  uncleared: ynab.TransactionClearedStatus.Uncleared,
  reconciled: ynab.TransactionClearedStatus.Reconciled,
};

export const updateTransaction = defineTool({
  name: "ynab_update_transaction",
  title: "Update Transaction",
  description:
    "Updates an existing transaction. All fields except transactionId are optional - only provide fields you want to change.",
  inputSchema: {
    planId: planIdParam,
    transactionId: z.string().describe("The ID of the transaction to update"),
    accountId: z.string().optional().describe("Move transaction to a different account"),
    date: z.string().optional().describe("The date of the transaction in ISO format (e.g. 2024-03-24)"),
    amount: z.number().optional().describe("The amount in dollars (e.g. -10.99 for outflow, 10.99 for inflow)"),
    payeeId: z.string().optional().describe("The ID of the payee"),
    payeeName: z.string().optional().describe("The name of the payee (creates new payee if doesn't exist)"),
    categoryId: z.string().optional().describe("The category ID for the transaction"),
    memo: z.string().optional().describe("A memo/note for the transaction"),
    cleared: clearedParam.optional().describe("The cleared status"),
    approved: z.boolean().optional().describe("Whether the transaction is approved"),
    flagColor: flagColorParam.optional().describe("The transaction flag color"),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const update: ynab.ExistingTransaction = {};
    if (input.accountId !== undefined) update.account_id = input.accountId;
    if (input.date !== undefined) update.date = input.date;
    if (input.amount !== undefined) update.amount = Math.round(input.amount * 1000);
    if (input.payeeId !== undefined) update.payee_id = input.payeeId;
    if (input.payeeName !== undefined) update.payee_name = input.payeeName;
    if (input.categoryId !== undefined) update.category_id = input.categoryId;
    if (input.memo !== undefined) update.memo = input.memo;
    if (input.cleared !== undefined) update.cleared = clearedStatus[input.cleared];
    if (input.approved !== undefined) update.approved = input.approved;
    if (input.flagColor !== undefined) update.flag_color = input.flagColor as ynab.TransactionFlagColor;

    const response = await ctx.api.transactions.updateTransaction(ctx.planId(input.planId), input.transactionId, {
      transaction: update,
    });
    const txn = response.data.transaction;
    return {
      success: true,
      transaction: {
        id: txn.id,
        date: txn.date,
        amount: (txn.amount / 1000).toFixed(2),
        payee_name: txn.payee_name,
        category_name: txn.category_name,
        memo: txn.memo,
        cleared: txn.cleared,
        approved: txn.approved,
        account_name: txn.account_name,
        flag_color: txn.flag_color,
      },
      message: "Transaction updated successfully",
    };
  },
});
