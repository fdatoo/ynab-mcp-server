import { defineTool } from "../defineTool.js";
import { categoryRef, monthParam, normalizeMonth, planIdParam } from "../common.js";
import { fromMilliunits } from "../../ynab/money.js";
import { formatGoalFull } from "./format.js";

export const getCategory = defineTool({
  name: "ynab_get_category",
  title: "Get Category",
  description: "Gets one category's assigned, activity and available amounts for a month, with full goal detail.",
  inputSchema: {
    planId: planIdParam,
    category: categoryRef,
    month: monthParam.default("current"),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const month = normalizeMonth(input.month);
    const resolved = await ctx.lookup.resolveCategory(planId, input.category);

    const { data } = await ctx.api.categories.getMonthCategoryById(planId, month, resolved.id);
    const category = data.category;
    const goal = formatGoalFull(category, currency);

    return {
      currency: currency.iso_code,
      month,
      id: category.id,
      name: category.name,
      group: resolved.category_group_name,
      assigned: fromMilliunits(category.budgeted, currency),
      activity: fromMilliunits(category.activity, currency),
      available: fromMilliunits(category.balance, currency),
      ...(goal ? { goal } : {}),
      ...(category.note ? { note: category.note } : {}),
      hidden: category.hidden,
    };
  },
});
