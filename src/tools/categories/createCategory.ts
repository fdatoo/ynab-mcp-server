import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { amountParam, categoryGroupRef, dateParam, planIdParam, resolveCategoryGroup } from "../common.js";
import { toMilliunits } from "../../ynab/money.js";

export const createCategory = defineTool({
  name: "ynab_create_category",
  title: "Create Category",
  description:
    "Creates a category in an existing category group. Optionally sets a monthly goal target and target date. " +
    "The API cannot create a hidden category; use ynab_update_category_group if the group itself should be hidden.",
  inputSchema: {
    planId: planIdParam,
    group: categoryGroupRef,
    name: z.string().min(1).max(100),
    note: z.string().max(500).optional(),
    goalTarget: amountParam.optional().describe("Monthly goal target amount"),
    goalTargetDate: dateParam.optional().describe("Target date for the goal, if it has one"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const { data: groupsData } = await ctx.api.categories.getCategories(planId);
    const group = resolveCategoryGroup(input.group, groupsData.category_groups);

    const { data } = await ctx.api.categories.createCategory(planId, {
      category: {
        name: input.name,
        category_group_id: group.id,
        note: input.note,
        goal_target: input.goalTarget !== undefined ? toMilliunits(input.goalTarget, currency) : undefined,
        goal_target_date: input.goalTargetDate,
      },
    });
    ctx.lookup.invalidate(planId, ["categories"]);

    return { id: data.category.id, name: data.category.name, group: group.name };
  },
});
