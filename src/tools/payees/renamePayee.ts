import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { payeeRef, planIdParam } from "../common.js";

export const renamePayee = defineTool({
  name: "ynab_rename_payee",
  title: "Rename Payee",
  description: "Renames a payee, given by id or name. Payees cannot be deleted or merged through the API.",
  inputSchema: {
    planId: planIdParam,
    payee: payeeRef,
    name: z.string().min(1).describe("New name"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const payee = await ctx.lookup.resolvePayee(planId, input.payee);
    if (payee.transfer_account_id) {
      throw new Error(`"${payee.name}" is the automatic transfer payee for an account and cannot be renamed; rename the account instead.`);
    }

    const { data } = await ctx.api.payees.updatePayee(planId, payee.id, { payee: { name: input.name } });
    ctx.lookup.invalidate(planId, ["payees"]);
    return { payee: { id: data.payee.id, name: data.payee.name } };
  },
});
