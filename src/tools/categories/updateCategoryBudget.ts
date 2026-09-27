import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const updateCategoryBudget = defineTool({
  name: "ynab_update_category_budget",
  title: "Update Category Budget",
  description:
    "Updates the budgeted amount for a category in a specific month. Use this to allocate funds to categories or move money between categories.",
  inputSchema: {
    planId: planIdParam,
    month: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("The budget month in ISO format (e.g. 2024-01-01). Must be the first day of the month."),
    categoryId: z.string().describe("The ID of the category to update"),
    budgeted: z
      .number()
      .describe("The amount to budget in dollars (e.g. 500.00). This sets the total budgeted amount, not an increment."),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const response = await ctx.api.categories.updateMonthCategory(ctx.planId(input.planId), input.month, input.categoryId, {
      category: { budgeted: Math.round(input.budgeted * 1000) },
    });
    const category = response.data.category;
    return {
      success: true,
      category: {
        id: category.id,
        name: category.name,
        budgeted: (category.budgeted / 1000).toFixed(2),
        activity: (category.activity / 1000).toFixed(2),
        balance: (category.balance / 1000).toFixed(2),
      },
      message: `Successfully updated ${category.name} budget to $${(category.budgeted / 1000).toFixed(2)}`,
    };
  },
});
