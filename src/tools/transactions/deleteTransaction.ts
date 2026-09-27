import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const deleteTransaction = defineTool({
  name: "ynab_delete_transaction",
  title: "Delete Transaction",
  description: "Deletes a transaction from the plan. This action cannot be undone.",
  inputSchema: {
    planId: planIdParam,
    transactionId: z.string().describe("The ID of the transaction to delete"),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const response = await ctx.api.transactions.deleteTransaction(ctx.planId(input.planId), input.transactionId);
    return { success: true, transactionId: response.data.transaction.id, message: "Transaction deleted successfully" };
  },
});
