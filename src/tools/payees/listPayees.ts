import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const listPayees = defineTool({
  name: "ynab_list_payees",
  title: "List Payees",
  description: "Lists all payees in a plan. Useful for finding payee IDs when creating transactions.",
  inputSchema: { planId: planIdParam },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const response = await ctx.api.payees.getPayees(ctx.planId(input.planId));
    const payees = response.data.payees
      .filter((payee) => !payee.deleted)
      .map((payee) => ({ id: payee.id, name: payee.name, transfer_account_id: payee.transfer_account_id }));
    return { payees, payee_count: payees.length };
  },
});
