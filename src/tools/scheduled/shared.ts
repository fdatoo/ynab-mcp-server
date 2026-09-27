import { z } from "zod";
import type { ToolContext } from "../defineTool.js";

export const frequencyParam = z
  .enum([
    "never",
    "daily",
    "weekly",
    "everyOtherWeek",
    "twiceAMonth",
    "every4Weeks",
    "monthly",
    "everyOtherMonth",
    "every3Months",
    "every4Months",
    "twiceAYear",
    "yearly",
    "everyOtherYear",
  ])
  .describe("How often the transaction repeats after the first occurrence; 'never' for a one-off");

/** A scheduled date must be strictly after today (UTC), so tomorrow is the earliest allowed. */
export function requireFutureDate(date: string, today = new Date()): void {
  const todayIso = today.toISOString().slice(0, 10);
  if (date <= todayIso) {
    throw new Error(`date must be in the future (today is ${todayIso}); a scheduled transaction cannot be dated today or earlier.`);
  }
}

/** Resolves a payee reference: an existing payee's id, or a name the API will create. */
export async function resolveScheduledPayee(
  ctx: ToolContext,
  planId: string,
  ref: string,
  newPayees: string[]
): Promise<{ payee_id: string | null; payee_name?: string }> {
  try {
    const payee = await ctx.lookup.resolvePayee(planId, ref);
    return { payee_id: payee.id };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("No payee matches")) throw error;
    newPayees.push(ref);
    return { payee_id: null, payee_name: ref };
  }
}
