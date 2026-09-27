import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const createPayee = defineTool({
  name: "ynab_create_payee",
  title: "Create Payee",
  description: "Creates a payee, or returns the existing one with that name. Usually unnecessary: creating a transaction with a new payee name creates the payee too.",
  inputSchema: {
    planId: planIdParam,
    name: z.string().min(1),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    // Payees can't be deleted or merged through the API, so a duplicate would be permanent.
    const existing = (await ctx.lookup.payees(planId, { refresh: true })).find(
      (payee) => payee.name.trim().toLowerCase() === input.name.trim().toLowerCase()
    );
    if (existing) return { payee: { id: existing.id, name: existing.name }, already_existed: true };
    const { data } = await ctx.api.payees.createPayee(planId, { payee: { name: input.name } });
    ctx.lookup.invalidate(planId, ["payees"]);
    return { payee: { id: data.payee.id, name: data.payee.name } };
  },
});
