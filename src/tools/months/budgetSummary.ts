import { defineTool } from "../defineTool.js";
import { monthParam, normalizeMonth, planIdParam } from "../common.js";
import { fromMilliunits } from "../../ynab/money.js";

export const budgetSummary = defineTool({
  name: "ynab_budget_summary",
  title: "Budget Summary",
  description:
    "Summarizes a month: Ready to Assign, income, assigned and activity totals, age of money, overspent categories, " +
    "underfunded goals, and the top spending categories. Hidden and deleted categories are excluded.",
  inputSchema: {
    planId: planIdParam,
    month: monthParam.default("current"),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const month = normalizeMonth(input.month);

    const [{ data }, groups] = await Promise.all([
      ctx.api.months.getPlanMonth(planId, month),
      ctx.api.categories.getCategories(planId),
    ]);
    // A hidden group's categories are not necessarily flagged hidden themselves.
    // Group-level internal is not a filter: the API sets it on YNAB's default groups too.
    const excludedGroups = new Set(
      groups.data.category_groups.filter((group) => group.deleted || group.hidden).map((group) => group.id)
    );
    const categories = data.month.categories.filter(
      (category) => !category.deleted && !category.hidden && !category.internal && !excludedGroups.has(category.category_group_id)
    );

    const overspent = categories
      .filter((category) => category.balance < 0)
      .sort((a, b) => a.balance - b.balance)
      .map((category) => ({ name: category.name, available: fromMilliunits(category.balance, currency) }));

    const underfunded = categories
      .filter((category) => (category.goal_under_funded ?? 0) > 0)
      .sort((a, b) => (b.goal_under_funded ?? 0) - (a.goal_under_funded ?? 0))
      .map((category) => ({ name: category.name, needed: fromMilliunits(category.goal_under_funded!, currency) }));

    const topSpending = categories
      .filter((category) => category.activity < 0)
      .sort((a, b) => a.activity - b.activity)
      .slice(0, 5)
      .map((category) => ({ name: category.name, activity: fromMilliunits(category.activity, currency) }));

    return {
      currency: currency.iso_code,
      month,
      ready_to_assign: fromMilliunits(data.month.to_be_budgeted, currency),
      income: fromMilliunits(data.month.income, currency),
      assigned: fromMilliunits(data.month.budgeted, currency),
      activity: fromMilliunits(data.month.activity, currency),
      age_of_money: data.month.age_of_money ?? null,
      overspent,
      underfunded,
      top_spending: topSpending,
    };
  },
});
