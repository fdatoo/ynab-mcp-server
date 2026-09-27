import { defineTool } from "../defineTool.js";
import { monthParam, normalizeMonth, planIdParam } from "../common.js";
import { fromMilliunits } from "../../ynab/money.js";

export const listMonths = defineTool({
  name: "ynab_list_months",
  title: "List Months",
  description: "Lists plan months with their income, assigned and activity totals, Ready to Assign, and age of money.",
  inputSchema: {
    planId: planIdParam,
    sinceMonth: monthParam.optional().describe("Only months from this month onward"),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const since = input.sinceMonth ? normalizeMonth(input.sinceMonth) : undefined;

    const { data } = await ctx.api.months.getPlanMonths(planId);
    const months = data.months
      .filter((month) => !month.deleted && (!since || month.month >= since))
      .map((month) => ({
        month: month.month,
        income: fromMilliunits(month.income, currency),
        assigned: fromMilliunits(month.budgeted, currency),
        activity: fromMilliunits(month.activity, currency),
        ready_to_assign: fromMilliunits(month.to_be_budgeted, currency),
        age_of_money: month.age_of_money ?? null,
      }));

    return { currency: currency.iso_code, months, month_count: months.length };
  },
});
