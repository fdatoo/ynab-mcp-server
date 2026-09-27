import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";
import { formatTransaction } from "../format.js";

export const getTransaction = defineTool({
  name: "ynab_get_transaction",
  title: "Get Transaction",
  description:
    "Fetches a single transaction by id, including its split lines (if any), import status, and transfer details (if it is a transfer).",
  inputSchema: {
    planId: planIdParam,
    transactionId: z.string().describe("Transaction id"),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const { data } = await ctx.api.transactions.getTransactionById(planId, input.transactionId);
    const txn = data.transaction;

    return {
      currency: currency.iso_code,
      ...formatTransaction(txn, currency),
      import_id: txn.import_id ?? null,
      matched_transaction_id: txn.matched_transaction_id ?? null,
      ...(txn.transfer_transaction_id ? { transfer_transaction_id: txn.transfer_transaction_id } : {}),
    };
  },
});
