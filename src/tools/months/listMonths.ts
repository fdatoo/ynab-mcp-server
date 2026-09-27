import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const listMonths = defineTool({
  name: "ynab_list_months",
  title: "List Months",
  description: "Lists all plan months. Each month contains summary information about budgeting status.",
  inputSchema: { planId: planIdParam },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const response = await ctx.api.months.getPlanMonths(ctx.planId(input.planId));
    const months = response.data.months.map((month) => ({
      month: month.month,
      note: month.note,
      income: (month.income / 1000).toFixed(2),
      budgeted: (month.budgeted / 1000).toFixed(2),
      activity: (month.activity / 1000).toFixed(2),
      to_be_budgeted: (month.to_be_budgeted / 1000).toFixed(2),
      age_of_money: month.age_of_money,
    }));
    return { months, month_count: months.length };
  },
});
