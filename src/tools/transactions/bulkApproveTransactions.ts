import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const bulkApproveTransactions = defineTool({
  name: "ynab_bulk_approve_transactions",
  title: "Bulk Approve Transactions",
  description:
    "Approves multiple transactions at once. Provide an array of transaction IDs to approve them all in a single API call.",
  inputSchema: {
    planId: planIdParam,
    transactionIds: z.array(z.string()).describe("Array of transaction IDs to approve"),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  async handler(input, ctx) {
    if (input.transactionIds.length === 0) throw new Error("No transaction IDs provided");
    const response = await ctx.api.transactions.updateTransactions(ctx.planId(input.planId), {
      transactions: input.transactionIds.map((id) => ({ id, approved: true })),
    });
    const updated = (response.data.transactions ?? []).map((txn) => ({
      id: txn.id,
      date: txn.date,
      amount: (txn.amount / 1000).toFixed(2),
      payee_name: txn.payee_name,
      approved: txn.approved,
    }));
    return {
      success: true,
      approved_count: updated.length,
      transactions: updated,
      message: `Successfully approved ${updated.length} transaction(s)`,
    };
  },
});
