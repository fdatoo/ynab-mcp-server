import { z } from "zod";

export const planIdParam = z
  .string()
  .optional()
  .describe("Plan (budget) id. Optional: defaults to YNAB_PLAN_ID, then the most recently used plan.");

export const flagColorParam = z.enum(["red", "orange", "yellow", "green", "blue", "purple"]);

export const clearedParam = z.enum(["cleared", "uncleared", "reconciled"]);

export const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const monthParam = z
  .string()
  .regex(/^(current|\d{4}-\d{2}(-\d{2})?)$/, "Use YYYY-MM, YYYY-MM-DD or 'current'")
  .describe("Plan month: 'current', YYYY-MM, or any date in the month");

/** A positive amount in the plan's currency. Direction is always a separate, required field. */
export const amountParam = z.number().positive().describe("Amount in the plan's currency, always positive (e.g. 12.5)");

/** A zero-or-positive amount, for fields like an assigned amount that can legitimately be set to zero. */
export const nonNegativeAmountParam = z.number().nonnegative().describe("Amount in the plan's currency, zero or positive (e.g. 12.5 or 0)");

export const categoryGroupRef = z.string().describe("Category group id or exact name");

export const directionParam = z
  .enum(["outflow", "inflow"])
  .describe("'outflow' for money leaving the account (spending), 'inflow' for money arriving (income, refunds)");

export const accountRef = z.string().describe("Account id or exact account name");
export const categoryRef = z.string().describe("Category id, name, or 'Group: Name' when names repeat");
export const payeeRef = z.string().describe("Payee id or exact payee name");

/** Normalizes a monthParam value to the first day of the month, as the API expects. */
export function normalizeMonth(month: string, today = new Date()): string {
  if (month === "current") return `${today.toISOString().slice(0, 7)}-01`;
  return `${month.slice(0, 7)}-01`;
}

export function signedMilliunits(milliunits: number, direction: "outflow" | "inflow"): number {
  return direction === "outflow" ? -Math.abs(milliunits) : Math.abs(milliunits);
}

/**
 * Finds a category group by id or exact name among the groups returned by
 * getCategories. Unlike category resolution there is no cache: callers that
 * need this already hold a fresh getCategories response, because creating or
 * moving a category needs one anyway.
 */
export function resolveCategoryGroup<T extends { id: string; name: string; deleted?: boolean }>(ref: string, groups: T[]): T {
  const candidates = groups.filter((group) => !group.deleted);
  const byId = candidates.find((group) => group.id === ref);
  if (byId) return byId;

  const exact = candidates.filter((group) => group.name.trim().toLowerCase() === ref.trim().toLowerCase());
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const options = exact.map((group) => `${group.name} (${group.id})`);
    throw new Error(`"${ref}" matches more than one category group: ${options.join("; ")}. Use the id.`);
  }

  const needle = ref.trim().toLowerCase();
  const suggestions = candidates.filter((group) => group.name.toLowerCase().includes(needle)).map((group) => group.name);
  throw new Error(`No category group matches "${ref}".` + (suggestions.length ? ` Did you mean: ${suggestions.slice(0, 5).join(", ")}?` : ""));
}
