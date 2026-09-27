import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const createCategoryGroup = defineTool({
  name: "ynab_create_category_group",
  title: "Create Category Group",
  description: "Creates a new category group.",
  inputSchema: {
    planId: planIdParam,
    name: z.string().min(1).max(50),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const { data } = await ctx.api.categories.createCategoryGroup(planId, { category_group: { name: input.name } });
    ctx.lookup.invalidate(planId, ["categories"]);
    return { id: data.category_group.id, name: data.category_group.name };
  },
});
