import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";
import { fromMilliunits } from "../../ynab/money.js";

export const listAccounts = defineTool({
  name: "ynab_list_accounts",
  title: "List Accounts",
  description:
    "Lists accounts in a plan, with balances in the plan's currency. " +
    "direct_import_in_error flags an account whose bank connection is broken and needs fixing in the YNAB app.",
  inputSchema: {
    planId: planIdParam,
    includeClosedAccounts: z.boolean().optional().describe("Include closed accounts in the list (default: false)"),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const response = await ctx.api.accounts.getAccounts(planId);
    const accounts = response.data.accounts
      .filter((account) => !account.deleted && (input.includeClosedAccounts || !account.closed))
      .map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        on_budget: account.on_budget,
        closed: account.closed,
        balance: fromMilliunits(account.balance, currency),
        cleared_balance: fromMilliunits(account.cleared_balance, currency),
        uncleared_balance: fromMilliunits(account.uncleared_balance, currency),
        note: account.note ?? null,
        last_reconciled_at: account.last_reconciled_at ?? null,
        direct_import_linked: account.direct_import_linked ?? false,
        direct_import_in_error: account.direct_import_in_error ?? false,
      }));
    return { currency: currency.iso_code, accounts, account_count: accounts.length };
  },
});
