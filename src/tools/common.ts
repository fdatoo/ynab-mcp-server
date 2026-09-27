import { z } from "zod";

export const planIdParam = z
  .string()
  .optional()
  .describe("Plan (budget) id. Optional: defaults to YNAB_PLAN_ID, then the most recently used plan.");

export const flagColorParam = z.enum(["red", "orange", "yellow", "green", "blue", "purple"]);

export const clearedParam = z.enum(["cleared", "uncleared", "reconciled"]);
