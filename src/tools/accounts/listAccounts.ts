import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const listAccounts = defineTool({
  name: "ynab_list_accounts",
  title: "List Accounts",
  description: "Lists all accounts in a plan. Useful for finding account IDs when creating transactions.",
  inputSchema: {
    planId: planIdParam,
    includeClosedAccounts: z.boolean().optional().describe("Include closed accounts in the list (default: false)"),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const response = await ctx.api.accounts.getAccounts(ctx.planId(input.planId));
    const accounts = response.data.accounts
      .filter((account) => !account.deleted && (input.includeClosedAccounts || !account.closed))
      .map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        on_budget: account.on_budget,
        closed: account.closed,
        balance: (account.balance / 1000).toFixed(2),
        cleared_balance: (account.cleared_balance / 1000).toFixed(2),
        uncleared_balance: (account.uncleared_balance / 1000).toFixed(2),
        transfer_payee_id: account.transfer_payee_id,
      }));
    return { accounts, account_count: accounts.length };
  },
});
