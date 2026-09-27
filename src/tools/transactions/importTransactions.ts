import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const importTransactions = defineTool({
  name: "ynab_import_transactions",
  title: "Import Transactions",
  description:
    "Imports available transactions on all linked accounts for the plan. This triggers an import from connected financial institutions (equivalent to clicking 'Import' in the YNAB app).",
  inputSchema: { planId: planIdParam },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const response = await ctx.api.transactions.importTransactions(ctx.planId(input.planId));
    const ids = response.data.transaction_ids;
    return {
      success: true,
      transaction_ids: ids,
      imported_count: ids.length,
      message: ids.length > 0 ? `Successfully imported ${ids.length} transaction(s)` : "No new transactions to import",
    };
  },
});
