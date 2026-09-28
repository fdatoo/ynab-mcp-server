import { z } from "zod";
import type { ToolContext } from "../defineTool.js";
import { amountParam, categoryRef, directionParam, payeeRef } from "../common.js";
import { isCreditCardPaymentCategory } from "../system.js";

/** One line of a split, shared by creating a split and turning a transaction into one. */
export const splitLine = z.strictObject({
  amount: amountParam,
  direction: directionParam.optional().describe("Defaults to the transaction's direction"),
  category: categoryRef.optional(),
  payee: payeeRef.optional().describe("Payee for this line, if different"),
  memo: z.string().max(500).optional(),
});

/** Resolves a payee reference: an existing payee's id, or a name the API will create (recorded in newPayees). */
export async function payeeFields(ctx: ToolContext, planId: string, ref: string, newPayees: string[]) {
  try {
    const payee = await ctx.lookup.resolvePayee(planId, ref);
    return { payee_id: payee.id };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("No payee matches")) throw error;
    newPayees.push(ref);
    return { payee_name: ref };
  }
}

/** Resolves a category for a transaction, refusing the ones YNAB would silently drop. */
export async function transactionCategoryId(ctx: ToolContext, planId: string, ref: string): Promise<string> {
  const category = await ctx.lookup.resolveCategory(planId, ref);
  if (isCreditCardPaymentCategory(category)) {
    throw new Error(
      `"${category.name}" is a credit card payment category, which a transaction cannot use (YNAB would store it as Uncategorized). ` +
        "To pay a card, make a transfer to the card account with transferToAccount; to fund the payment, use ynab_assign."
    );
  }
  return category.id;
}
