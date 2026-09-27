import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";
import { formatScheduledTransaction } from "./format.js";

export const deleteScheduledTransaction = defineTool({
  name: "ynab_delete_scheduled_transaction",
  title: "Delete Scheduled Transaction",
  description: "Deletes a scheduled transaction. This cannot be undone; no further occurrences will be created.",
  inputSchema: {
    planId: planIdParam,
    scheduledTransactionId: z.string().describe("The scheduled transaction's id"),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const { data } = await ctx.api.scheduledTransactions.deleteScheduledTransaction(planId, input.scheduledTransactionId);
    return { deleted: formatScheduledTransaction(data.scheduled_transaction, currency) };
  },
});
