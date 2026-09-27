import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { categoryGroupRef, planIdParam, resolveCategoryGroup } from "../common.js";

export const updateCategoryGroup = defineTool({
  name: "ynab_update_category_group",
  title: "Update Category Group",
  description: "Renames a category group. The name is the only field the API can update.",
  inputSchema: {
    planId: planIdParam,
    group: categoryGroupRef,
    name: z.string().min(1).max(50),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const { data } = await ctx.api.categories.getCategories(planId);
    const group = resolveCategoryGroup(input.group, data.category_groups);

    const response = await ctx.api.categories.updateCategoryGroup(planId, group.id, { category_group: { name: input.name } });
    ctx.lookup.invalidate(planId, ["categories"]);
    return { id: response.data.category_group.id, name: response.data.category_group.name };
  },
});
