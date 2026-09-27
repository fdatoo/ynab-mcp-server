import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const listCategories = defineTool({
  name: "ynab_list_categories",
  title: "List Categories",
  description:
    "Lists all categories in a plan, grouped by category group. Useful for finding category IDs when creating transactions or updating budgets.",
  inputSchema: { planId: planIdParam },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const response = await ctx.api.categories.getCategories(ctx.planId(input.planId));
    const categoryGroups = response.data.category_groups
      .filter((group) => !group.deleted && !group.hidden)
      .map((group) => ({
        id: group.id,
        name: group.name,
        hidden: group.hidden,
        categories: group.categories
          .filter((cat) => !cat.deleted && !cat.hidden)
          .map((cat) => ({
            id: cat.id,
            name: cat.name,
            budgeted: (cat.budgeted / 1000).toFixed(2),
            activity: (cat.activity / 1000).toFixed(2),
            balance: (cat.balance / 1000).toFixed(2),
            goal_type: cat.goal_type,
            goal_target: cat.goal_target ? (cat.goal_target / 1000).toFixed(2) : null,
            goal_percentage_complete: cat.goal_percentage_complete,
          })),
      }));
    const categoryCount = categoryGroups.reduce((sum, group) => sum + group.categories.length, 0);
    return { category_groups: categoryGroups, group_count: categoryGroups.length, category_count: categoryCount };
  },
});
