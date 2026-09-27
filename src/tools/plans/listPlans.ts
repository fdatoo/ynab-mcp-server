import { defineTool } from "../defineTool.js";

export const listPlans = defineTool({
  name: "ynab_list_plans",
  title: "List Plans",
  description:
    "Lists every plan (budget) available to the token, with id, name, last modified time and currency. " +
    "One plan is marked default when YNAB_PLAN_ID is configured; otherwise the default is whichever plan YNAB last used, which this list cannot identify.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(_input, ctx) {
    const response = await ctx.api.plans.getPlans();
    const configuredPlanId = ctx.planId();
    const hasConfiguredDefault = configuredPlanId !== "last-used";

    return {
      plans: response.data.plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        last_modified_on: plan.last_modified_on ?? null,
        currency: plan.currency_format?.iso_code ?? null,
        default: hasConfiguredDefault && plan.id === configuredPlanId,
      })),
      ...(hasConfiguredDefault
        ? {}
        : { note: "No default plan is configured (YNAB_PLAN_ID unset); YNAB falls back to the last plan used in the app, not shown here." }),
    };
  },
});
