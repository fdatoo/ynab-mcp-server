import type * as ynab from "ynab";
import { defineTool } from "../defineTool.js";
import { monthParam, normalizeMonth, planIdParam } from "../common.js";
import { fromMilliunits } from "../../ynab/money.js";

const READY_TO_ASSIGN = "Ready to Assign";
// The API's internal category for income; money movements refer to Ready to
// Assign through it, either by this id or by leaving the field null.
const INFLOW_CATEGORY_NAME = "Inflow: Ready to Assign";

export const listMoneyMovements = defineTool({
  name: "ynab_list_money_movements",
  title: "List Money Movements",
  description:
    "Lists the history of money moved between categories (and to or from Ready to Assign), newest first. " +
    "Optionally limited to one month.",
  inputSchema: {
    planId: planIdParam,
    month: monthParam.optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const month = input.month ? normalizeMonth(input.month) : undefined;

    const [{ data }, categories] = await Promise.all([
      month ? ctx.api.money_movements.getMoneyMovementsByMonth(planId, month) : ctx.api.money_movements.getMoneyMovements(planId),
      ctx.lookup.categories(planId),
    ]);
    const namesById = new Map(categories.map((category) => [category.id, category.name]));
    const nameOf = (categoryId: string | null | undefined) => {
      if (!categoryId) return READY_TO_ASSIGN;
      const name = namesById.get(categoryId);
      if (name === INFLOW_CATEGORY_NAME) return READY_TO_ASSIGN;
      return name ?? "Unknown Category";
    };

    const movements = [...data.money_movements]
      .sort((a, b) => (b.moved_at ?? "").localeCompare(a.moved_at ?? ""))
      .map((movement: ynab.MoneyMovement) => ({
        id: movement.id,
        month: movement.month ?? null,
        moved_at: movement.moved_at ?? null,
        from: nameOf(movement.from_category_id),
        to: nameOf(movement.to_category_id),
        amount: fromMilliunits(movement.amount, currency),
        ...(movement.note ? { note: movement.note } : {}),
        ...(movement.performed_by_user_id ? { user: movement.performed_by_user_id } : {}),
        ...(movement.money_movement_group_id ? { group_id: movement.money_movement_group_id } : {}),
      }));

    const groupIds = [...new Set(movements.map((m) => m.group_id).filter((id): id is string => !!id))];
    const groups = groupIds.map((id) => ({ id, movements: movements.filter((m) => m.group_id === id) }));

    return {
      currency: currency.iso_code,
      month: month ?? null,
      movements,
      movement_count: movements.length,
      ...(groups.length > 0 ? { groups } : {}),
    };
  },
});
