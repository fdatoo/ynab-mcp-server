import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { amountParam, categoryGroupRef, categoryRef, dateParam, planIdParam, resolveCategoryGroup } from "../common.js";
import { toMilliunits } from "../../ynab/money.js";

export const updateCategory = defineTool({
  name: "ynab_update_category",
  title: "Update Category",
  description:
    "Renames a category, edits its note, moves it to another group, or sets its goal target amount and target date. " +
    "The API cannot hide or delete a category; ynab_assign it to zero and leave it be, or hide the whole group instead.",
  inputSchema: {
    planId: planIdParam,
    category: categoryRef,
    name: z.string().min(1).max(100).optional(),
    note: z.string().max(500).optional(),
    group: categoryGroupRef.optional().describe("Move the category into this group"),
    goalTarget: amountParam.optional().describe("Monthly goal target amount"),
    goalTargetDate: dateParam.optional().describe("Target date for the goal, if it has one"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const category = await ctx.lookup.resolveCategory(planId, input.category);

    let groupId: string | undefined;
    let groupName: string | undefined;
    if (input.group) {
      const { data } = await ctx.api.categories.getCategories(planId);
      const group = resolveCategoryGroup(input.group, data.category_groups);
      groupId = group.id;
      groupName = group.name;
    }

    const { data } = await ctx.api.categories.updateCategory(planId, category.id, {
      category: {
        name: input.name,
        note: input.note,
        category_group_id: groupId,
        goal_target: input.goalTarget !== undefined ? toMilliunits(input.goalTarget, currency) : undefined,
        goal_target_date: input.goalTargetDate,
      },
    });
    ctx.lookup.invalidate(planId, ["categories"]);

    return { id: data.category.id, name: data.category.name, group: groupName ?? category.category_group_name };
  },
});
