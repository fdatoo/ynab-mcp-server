import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const listPayees = defineTool({
  name: "ynab_list_payees",
  title: "List Payees",
  description: "Lists payees in a plan. Transfer payees (the automatic one YNAB gives each account) are excluded unless asked for.",
  inputSchema: {
    planId: planIdParam,
    search: z.string().min(1).optional().describe("Case-insensitive text to match against the payee name"),
    includeTransferPayees: z.boolean().default(false).describe("Include the automatic transfer payee for each account"),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const response = await ctx.api.payees.getPayees(ctx.planId(input.planId));
    const search = input.search?.toLowerCase();
    const payees = response.data.payees
      .filter((payee) => !payee.deleted)
      .filter((payee) => input.includeTransferPayees || !payee.transfer_account_id)
      .filter((payee) => !search || payee.name.toLowerCase().includes(search))
      .map((payee) => ({ id: payee.id, name: payee.name, transfer_account_id: payee.transfer_account_id ?? null }));
    return { payees, payee_count: payees.length };
  },
});
