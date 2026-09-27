import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const importTransactions = defineTool({
  name: "ynab_import_transactions",
  title: "Import Transactions",
  description:
    "Imports available transactions on all linked accounts for the plan, the same as clicking 'Import' in the YNAB app. " +
    "Only genuinely new transactions are created; running this again when nothing changed imports nothing.",
  inputSchema: { planId: planIdParam },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const { data } = await ctx.api.transactions.importTransactions(planId);
    const ids = data.transaction_ids;
    // The API only returns imported ids here, never the transactions themselves,
    // so there is nothing to format; a new transaction may bring a new payee.
    if (ids.length > 0) ctx.lookup.invalidate(planId, ["accounts", "payees"]);
    return { imported_count: ids.length, transaction_ids: ids };
  },
});
