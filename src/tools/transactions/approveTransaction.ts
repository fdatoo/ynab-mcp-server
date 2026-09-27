import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const approveTransaction = defineTool({
  name: "ynab_approve_transaction",
  title: "Approve Transaction",
  description: "Approves an existing transaction in your plan.",
  inputSchema: {
    planId: planIdParam,
    transactionId: z.string().describe("The id of the transaction to approve"),
    approved: z.boolean().optional().default(true).describe("Whether the transaction should be marked as approved"),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const existing = await ctx.api.transactions.getTransactionById(planId, input.transactionId);
    const response = await ctx.api.transactions.updateTransaction(planId, existing.data.transaction.id, {
      transaction: { approved: input.approved ?? true },
    });
    return { success: true, transactionId: response.data.transaction.id, message: "Transaction updated successfully" };
  },
});
