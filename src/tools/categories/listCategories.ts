import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { monthParam, normalizeMonth, planIdParam } from "../common.js";
import { fromMilliunits } from "../../ynab/money.js";
import { formatCategorySummary } from "./format.js";

export const listCategories = defineTool({
  name: "ynab_list_categories",
  title: "List Categories",
  description:
    "Lists categories grouped by category group, with each category's assigned, activity and available amounts for a month. " +
    "Useful for finding category ids and seeing what needs attention.",
  inputSchema: {
    planId: planIdParam,
    month: monthParam.default("current"),
    includeHidden: z.boolean().default(false).describe("Include hidden categories and groups. The 'hidden' field is only returned when this is true."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const month = normalizeMonth(input.month);

    const [monthResponse, categoriesResponse] = await Promise.all([
      ctx.api.months.getPlanMonth(planId, month),
      ctx.api.categories.getCategories(planId),
    ]);
    const monthCategoriesById = new Map(monthResponse.data.month.categories.map((category) => [category.id, category]));

    const categoryGroups = categoriesResponse.data.category_groups
      // Only a category's own internal flag is meaningful: the API also marks
      // YNAB's default groups (Bills, Needs, Wants...) internal.
      .filter((group) => !group.deleted && (input.includeHidden || !group.hidden))
      .map((group) => {
        const monthCategories = group.categories
          .map((category) => monthCategoriesById.get(category.id) ?? category)
          .filter((category) => !category.deleted && !category.internal && (input.includeHidden || !category.hidden));
        return {
          raw_count: group.categories.filter((category) => !category.deleted).length,
          id: group.id,
          name: group.name,
          ...(input.includeHidden ? { hidden: group.hidden } : {}),
          categories: monthCategories.map((category) => formatCategorySummary(category, currency, input.includeHidden)),
          assigned_total: fromMilliunits(monthCategories.reduce((sum, c) => sum + c.budgeted, 0), currency),
          activity_total: fromMilliunits(monthCategories.reduce((sum, c) => sum + c.activity, 0), currency),
          available_total: fromMilliunits(monthCategories.reduce((sum, c) => sum + c.balance, 0), currency),
        };
      })
      // Drop groups that only held internal or hidden categories, but keep a genuinely empty (new) group.
      .filter((group) => group.categories.length > 0 || group.raw_count === 0)
      .map(({ raw_count: _rawCount, ...group }) => group);

    const categoryCount = categoryGroups.reduce((sum, group) => sum + group.categories.length, 0);
    return {
      currency: currency.iso_code,
      month,
      category_groups: categoryGroups,
      group_count: categoryGroups.length,
      category_count: categoryCount,
    };
  },
});
