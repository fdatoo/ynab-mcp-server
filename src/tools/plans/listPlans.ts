import { defineTool } from "../defineTool.js";

export const listPlans = defineTool({
  name: "ynab_list_budgets",
  title: "List Plans",
  description: "Lists all plans (budgets) available to the token, with their ids.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(_input, ctx) {
    const response = await ctx.api.plans.getPlans();
    return response.data.plans.map((plan) => ({ id: plan.id, name: plan.name }));
  },
});
