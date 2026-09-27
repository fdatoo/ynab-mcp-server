import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const budgetSummary = defineTool({
  name: "ynab_budget_summary",
  title: "Budget Summary",
  description:
    "Get a summary of the budget for a specific month highlighting overspent categories that need attention and categories with a positive balance that are doing well.",
  inputSchema: {
    planId: planIdParam,
    month: z
      .string()
      .regex(/^(current|\d{4}-\d{2}-\d{2})$/)
      .default("current")
      .describe(
        "The budget month in ISO format (e.g. 2016-12-01). The string 'current' can also be used to specify the current calendar month (UTC)"
      ),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const accountsResponse = await ctx.api.accounts.getAccounts(planId);
    const accounts = accountsResponse.data.accounts.filter((account) => !account.deleted && !account.closed);
    const monthBudget = await ctx.api.months.getPlanMonth(planId, input.month);
    return {
      monthBudget: monthBudget.data.month,
      accounts,
      note: "Divide all numbers by 1000 to get the balance in dollars.",
    };
  },
});
