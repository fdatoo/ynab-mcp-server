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
