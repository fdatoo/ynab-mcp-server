import { z } from "zod";
import type * as ynab from "ynab";
import { defineTool, type ToolContext } from "../defineTool.js";
import { amountParam, monthParam, normalizeMonth, planIdParam } from "../common.js";
import { fromMilliunits, toMilliunits, type Currency } from "../../ynab/money.js";
import { toYnabError } from "../../ynab/errors.js";
import type { CategoryWithGroup } from "../../ynab/lookup.js";

const READY_TO_ASSIGN = "ready to assign";

const moneyRef = z.string().describe('Category id, name, "Group: Name", or the literal "Ready to Assign"');

function isReadyToAssign(ref: string): boolean {
  return ref.trim().toLowerCase() === READY_TO_ASSIGN;
}

interface Side {
  label: string;
  category?: CategoryWithGroup;
}

async function resolveSide(ctx: ToolContext, planId: string, ref: string): Promise<Side> {
  if (isReadyToAssign(ref)) return { label: "Ready to Assign" };
  const category = await ctx.lookup.resolveCategory(planId, ref);
  return { label: category.name, category };
}

async function setBudgeted(ctx: ToolContext, planId: string, month: string, categoryId: string, budgeted: number): Promise<ynab.Category> {
  const { data } = await ctx.api.categories.updateMonthCategory(planId, month, categoryId, { category: { budgeted } });
  return data.category;
}

function amounts(category: ynab.Category, currency: Currency) {
  return { assigned: fromMilliunits(category.budgeted, currency), available: fromMilliunits(category.balance, currency) };
}

export const moveMoney = defineTool({
  name: "ynab_move_money",
  title: "Move Money",
  description:
    "Moves an assigned amount from one category to another, for a month. Either side can be the literal 'Ready to Assign' instead of a category: " +
    "moving to or from Ready to Assign only changes the one real category's assigned amount.",
  inputSchema: {
    planId: planIdParam,
    from: moneyRef,
    to: moneyRef,
    amount: amountParam,
    month: monthParam.default("current"),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const month = normalizeMonth(input.month);
    const amountMs = toMilliunits(input.amount, currency);

    const [from, to] = await Promise.all([resolveSide(ctx, planId, input.from), resolveSide(ctx, planId, input.to)]);
    if (!from.category && !to.category) throw new Error("from and to cannot both be Ready to Assign");
    if (from.category && to.category && from.category.id === to.category.id) {
      throw new Error(`from and to are the same category (${from.category.name})`);
    }

    const fromBeforeRequest = from.category ? ctx.api.categories.getMonthCategoryById(planId, month, from.category.id) : undefined;
    const toBeforeRequest = to.category ? ctx.api.categories.getMonthCategoryById(planId, month, to.category.id) : undefined;
    const fromBefore = fromBeforeRequest ? (await fromBeforeRequest).data.category : undefined;
    const toBefore = toBeforeRequest ? (await toBeforeRequest).data.category : undefined;

    let fromAfter: ynab.Category | undefined;
    let toAfter: ynab.Category | undefined;
    let fromCommitted = false;
    try {
      if (from.category && fromBefore) {
        fromAfter = await setBudgeted(ctx, planId, month, from.category.id, fromBefore.budgeted - amountMs);
        fromCommitted = true;
      }
      if (to.category && toBefore) {
        toAfter = await setBudgeted(ctx, planId, month, to.category.id, toBefore.budgeted + amountMs);
      }
    } catch (error) {
      if (fromCommitted && from.category && fromBefore) {
        try {
          await setBudgeted(ctx, planId, month, from.category.id, fromBefore.budgeted);
        } catch (revertError) {
          throw new Error(
            `Moving money from ${from.label} to ${to.label} failed, and reverting ${from.label}'s assigned amount also failed. ` +
              `${from.label} is currently left at ${fromMilliunits(fromBefore.budgeted - amountMs, currency)} instead of ${fromMilliunits(fromBefore.budgeted, currency)}; ` +
              `fix it manually with ynab_assign. (${toYnabError(error).message}; revert error: ${toYnabError(revertError).message})`
          );
        }
        throw new Error(
          `Moving money from ${from.label} to ${to.label} failed after lowering ${from.label}'s assigned amount; ` +
            `it has been reverted back to ${fromMilliunits(fromBefore.budgeted, currency)}. (${toYnabError(error).message})`
        );
      }
      throw toYnabError(error);
    }

    ctx.lookup.invalidate(planId, ["categories"]);

    const warning =
      from.category && fromAfter && fromAfter.balance < 0
        ? `${from.label}'s available balance is now negative (${fromMilliunits(fromAfter.balance, currency)}).`
        : undefined;

    return {
      currency: currency.iso_code,
      month,
      amount: input.amount,
      from: from.category && fromBefore && fromAfter
        ? { name: from.label, before: amounts(fromBefore, currency), after: amounts(fromAfter, currency) }
        : { name: from.label },
      to: to.category && toBefore && toAfter
        ? { name: to.label, before: amounts(toBefore, currency), after: amounts(toAfter, currency) }
        : { name: to.label },
      ...(warning ? { warning } : {}),
    };
  },
});
