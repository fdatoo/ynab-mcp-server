import type * as ynab from "ynab";
import { fromMilliunits, type Currency } from "../../ynab/money.js";

function money(milliunits: number | null | undefined, currency: Currency): number | undefined {
  return milliunits == null ? undefined : fromMilliunits(milliunits, currency);
}

/** Goal type, target, target date, underfunded amount and percent complete. Undefined when the category has no goal. */
export function formatGoalSummary(category: ynab.Category, currency: Currency) {
  if (!category.goal_type) return undefined;
  return {
    type: category.goal_type,
    ...(category.goal_target != null ? { target: money(category.goal_target, currency) } : {}),
    ...(category.goal_target_date ? { target_date: category.goal_target_date } : {}),
    ...(category.goal_under_funded != null ? { underfunded: money(category.goal_under_funded, currency) } : {}),
    ...(category.goal_percentage_complete != null ? { percent_complete: category.goal_percentage_complete } : {}),
  };
}

/** The goal summary plus the remaining goal fields, for a single-category lookup. */
export function formatGoalFull(category: ynab.Category, currency: Currency) {
  const summary = formatGoalSummary(category, currency);
  if (!summary) return undefined;
  return {
    ...summary,
    ...(category.goal_needs_whole_amount != null ? { needs_whole_amount: category.goal_needs_whole_amount } : {}),
    ...(category.goal_day != null ? { day: category.goal_day } : {}),
    ...(category.goal_cadence != null ? { cadence: category.goal_cadence } : {}),
    ...(category.goal_cadence_frequency != null ? { cadence_frequency: category.goal_cadence_frequency } : {}),
    ...(category.goal_creation_month ? { creation_month: category.goal_creation_month } : {}),
    ...(category.goal_months_to_budget != null ? { months_to_budget: category.goal_months_to_budget } : {}),
    ...(category.goal_overall_funded != null ? { overall_funded: money(category.goal_overall_funded, currency) } : {}),
    ...(category.goal_overall_left != null ? { overall_left: money(category.goal_overall_left, currency) } : {}),
    ...(category.goal_snoozed_at ? { snoozed_at: category.goal_snoozed_at } : {}),
  };
}

/**
 * A category's numbers for one month: assigned (the `budgeted` field, which
 * YNAB's UI calls Assigned), activity, and available (the `balance` field).
 * `hidden` is only included when the caller asked to see hidden categories.
 */
export function formatCategorySummary(category: ynab.Category, currency: Currency, includeHidden: boolean) {
  const goal = formatGoalSummary(category, currency);
  return {
    id: category.id,
    name: category.name,
    assigned: fromMilliunits(category.budgeted, currency),
    activity: fromMilliunits(category.activity, currency),
    available: fromMilliunits(category.balance, currency),
    ...(goal ? { goal } : {}),
    ...(category.note ? { note: category.note } : {}),
    ...(includeHidden ? { hidden: category.hidden } : {}),
  };
}
