import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";
import { formatTransaction } from "../format.js";

export const deleteTransaction = defineTool({
  name: "ynab_delete_transaction",
  title: "Delete Transaction",
  description: "Deletes a transaction. This cannot be undone. Deleting one side of a transfer deletes both sides.",
  inputSchema: {
    planId: planIdParam,
    transactionId: z.string().describe("Id of the transaction to delete"),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const { data } = await ctx.api.transactions.deleteTransaction(planId, input.transactionId);
    return { currency: currency.iso_code, deleted: formatTransaction(data.transaction, currency) };
  },
});
