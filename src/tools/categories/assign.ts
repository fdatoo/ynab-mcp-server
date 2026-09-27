import { z } from "zod";
import { categoryRef, monthParam, nonNegativeAmountParam, normalizeMonth, planIdParam } from "../common.js";
import { defineTool } from "../defineTool.js";
import { fromMilliunits, toMilliunits } from "../../ynab/money.js";

export const assign = defineTool({
  name: "ynab_assign",
  title: "Assign Money",
  description:
    "Sets, adds to, or removes from a category's assigned amount for a month (the API's `budgeted` field, which YNAB's UI now calls Assigned). " +
    "Returns the assigned and available amounts before and after, and the month's Ready to Assign after the change.",
  inputSchema: {
    planId: planIdParam,
    category: categoryRef,
    month: monthParam.default("current"),
    amount: nonNegativeAmountParam,
    mode: z
      .enum(["set", "add", "remove"])
      .describe("'set' replaces the assigned amount, 'add' increases it, 'remove' decreases it (rejected if that would go below zero)"),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const month = normalizeMonth(input.month);
    const category = await ctx.lookup.resolveCategory(planId, input.category);
    const amountMs = toMilliunits(input.amount, currency);

    const before = (await ctx.api.categories.getMonthCategoryById(planId, month, category.id)).data.category;

    let newBudgeted: number;
    if (input.mode === "set") newBudgeted = amountMs;
    else if (input.mode === "add") newBudgeted = before.budgeted + amountMs;
    else {
      newBudgeted = before.budgeted - amountMs;
      if (newBudgeted < 0) {
        throw new Error(
          `Removing ${input.amount} would take ${category.name}'s assigned amount below zero ` +
            `(currently ${fromMilliunits(before.budgeted, currency)}). Assign a smaller amount, or use mode "set" to set it directly.`
        );
      }
    }

    const { data } = await ctx.api.categories.updateMonthCategory(planId, month, category.id, { category: { budgeted: newBudgeted } });
    ctx.lookup.invalidate(planId, ["categories"]);
    const after = data.category;

    const monthAfter = await ctx.api.months.getPlanMonth(planId, month);

    return {
      currency: currency.iso_code,
      category: category.name,
      month,
      before: { assigned: fromMilliunits(before.budgeted, currency), available: fromMilliunits(before.balance, currency) },
      after: { assigned: fromMilliunits(after.budgeted, currency), available: fromMilliunits(after.balance, currency) },
      ready_to_assign: fromMilliunits(monthAfter.data.month.to_be_budgeted, currency),
    };
  },
});
