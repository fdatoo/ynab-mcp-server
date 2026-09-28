import { z } from "zod";
import { defineTool, type ToolContext } from "../defineTool.js";
import { categoryRef, monthParam, normalizeMonth, planIdParam } from "../common.js";
import { fromMilliunits, toMilliunits } from "../../ynab/money.js";
import { toYnabError } from "../../ynab/errors.js";

// Above this many writes, warn but proceed; above this many, refuse outright
// unless the caller already narrowed the run with maxTotal or categories.
// YNAB's rate limit is 200 requests per hour per token.
const WARN_WRITE_COUNT = 40;
const MAX_WRITE_COUNT = 150;

interface Candidate {
  categoryId: string;
  label: string;
  budgeted: number; // milliunits, current assigned
  shortfall: number; // milliunits, goal_under_funded
}

interface PlannedItem {
  categoryId: string;
  label: string;
  assignedBefore: number;
  amountToAdd: number;
  assignedAfter: number;
  shortfallBefore: number;
  shortfallAfter: number;
}

async function resolveIds(ctx: ToolContext, planId: string, refs: string[] | undefined): Promise<Set<string> | undefined> {
  if (!refs) return undefined;
  const categories = await Promise.all(refs.map((ref) => ctx.lookup.resolveCategory(planId, ref)));
  return new Set(categories.map((category) => category.id));
}

/**
 * Underfunded categories eligible for auto-assign: not deleted, hidden or
 * internal, not in a hidden or deleted group, with a positive shortfall, and
 * matching the categories/exclude filters. Group-level internal is not a
 * filter: the real API sets it on YNAB's default groups (Bills, Needs...) too.
 */
async function findCandidates(
  ctx: ToolContext,
  planId: string,
  month: string,
  filters: { categories?: string[]; exclude?: string[] }
): Promise<Candidate[]> {
  const [{ data: monthData }, { data: categoriesData }, includeIds, excludeIds] = await Promise.all([
    ctx.api.months.getPlanMonth(planId, month),
    ctx.api.categories.getCategories(planId),
    resolveIds(ctx, planId, filters.categories),
    resolveIds(ctx, planId, filters.exclude),
  ]);

  const excludedGroups = new Set(
    categoriesData.category_groups.filter((group) => group.deleted || group.hidden).map((group) => group.id)
  );
  const groupNameById = new Map(categoriesData.category_groups.map((group) => [group.id, group.name]));

  const candidates: Candidate[] = [];
  for (const category of monthData.month.categories) {
    if (category.deleted || category.hidden || category.internal) continue;
    if (excludedGroups.has(category.category_group_id)) continue;
    const shortfall = category.goal_under_funded ?? 0;
    if (shortfall <= 0) continue;
    if (includeIds && !includeIds.has(category.id)) continue;
    if (excludeIds?.has(category.id)) continue;
    const groupName = groupNameById.get(category.category_group_id) ?? "";
    candidates.push({ categoryId: category.id, label: `${groupName}: ${category.name}`, budgeted: category.budgeted, shortfall });
  }
  return candidates;
}

/** Funds the largest shortfall first; the last category funded may only get partial funding. */
function buildPlan(candidates: Candidate[], availableMs: number): { items: PlannedItem[]; totalMs: number; fullyFunded: boolean } {
  const ordered = [...candidates].sort((a, b) => b.shortfall - a.shortfall);
  let remaining = availableMs;
  const items: PlannedItem[] = [];
  for (const candidate of ordered) {
    if (remaining <= 0) break;
    const amount = Math.min(candidate.shortfall, remaining);
    remaining -= amount;
    items.push({
      categoryId: candidate.categoryId,
      label: candidate.label,
      assignedBefore: candidate.budgeted,
      amountToAdd: amount,
      assignedAfter: candidate.budgeted + amount,
      shortfallBefore: candidate.shortfall,
      shortfallAfter: candidate.shortfall - amount,
    });
  }
  const fullyFunded = items.length === ordered.length && items.every((item) => item.shortfallAfter === 0);
  return { items, totalMs: items.reduce((sum, item) => sum + item.amountToAdd, 0), fullyFunded };
}

export const autoAssign = defineTool({
  name: "ynab_auto_assign",
  title: "Auto-Assign to Underfunded",
  description:
    "Mirrors YNAB's \"Assign to underfunded goals\" for a month: funds the categories with the largest goal shortfall first, " +
    "up to what's available in Ready to Assign. Previews the plan unless dryRun is set to false; review the preview and confirm with the user before applying.",
  inputSchema: {
    planId: planIdParam,
    month: monthParam.default("current"),
    dryRun: z.boolean().default(true).describe("Preview the plan without writing anything. Set to false to apply it."),
    maxTotal: z.number().positive().optional().describe("Cap on how much of Ready to Assign to use, in the plan's currency"),
    categories: z.array(categoryRef).optional().describe("Restrict the run to these categories (id, name, or 'Group: Name')"),
    exclude: z.array(categoryRef).optional().describe("Skip these categories even if they are underfunded"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const month = normalizeMonth(input.month);

    const monthBefore = (await ctx.api.months.getPlanMonth(planId, month)).data.month;
    const candidates = await findCandidates(ctx, planId, month, { categories: input.categories, exclude: input.exclude });

    const maxTotalMs = input.maxTotal !== undefined ? toMilliunits(input.maxTotal, currency) : undefined;
    const availableMs = maxTotalMs !== undefined ? Math.min(monthBefore.to_be_budgeted, maxTotalMs) : monthBefore.to_be_budgeted;

    const readyToAssignBefore = fromMilliunits(monthBefore.to_be_budgeted, currency);

    if (candidates.length === 0 || availableMs <= 0) {
      return {
        currency: currency.iso_code,
        month,
        dry_run: input.dryRun,
        ready_to_assign_before: readyToAssignBefore,
        ready_to_assign_after: readyToAssignBefore,
        plan: [],
        total_assigned: 0,
        message:
          candidates.length === 0
            ? "No underfunded categories matched the filters given."
            : "Ready to Assign has nothing available to assign right now.",
      };
    }

    const { items, totalMs, fullyFunded } = buildPlan(candidates, availableMs);
    const plan = items.map((item) => ({
      category: item.label,
      assigned_before: fromMilliunits(item.assignedBefore, currency),
      amount: fromMilliunits(item.amountToAdd, currency),
      assigned_after: fromMilliunits(item.assignedAfter, currency),
      shortfall_before: fromMilliunits(item.shortfallBefore, currency),
      shortfall_after: fromMilliunits(item.shortfallAfter, currency),
    }));
    const partialNote = !fullyFunded
      ? "Ready to Assign runs out before every underfunded category is fully funded; the last one funded is only partially funded."
      : undefined;

    if (input.dryRun) {
      return {
        currency: currency.iso_code,
        month,
        dry_run: true,
        ready_to_assign_before: readyToAssignBefore,
        ready_to_assign_after: fromMilliunits(monthBefore.to_be_budgeted - totalMs, currency),
        plan,
        total_assigned: fromMilliunits(totalMs, currency),
        ...(partialNote ? { note: partialNote } : {}),
        confirm: "This is a preview; nothing has been written. Review it, then call again with dryRun set to false to apply it.",
      };
    }

    const narrowed = input.maxTotal !== undefined || (input.categories?.length ?? 0) > 0;
    if (items.length > MAX_WRITE_COUNT && !narrowed) {
      throw new Error(
        `This plan would make ${items.length} writes, above the refused limit of ${MAX_WRITE_COUNT}. ` +
          "Narrow it with maxTotal or categories, or run it in smaller batches."
      );
    }
    const rateLimitWarning =
      items.length > WARN_WRITE_COUNT
        ? `This plan makes ${items.length} writes; YNAB's rate limit is 200 requests per hour per token.`
        : undefined;

    const applied: (typeof plan)[number][] = [];
    const notApplied: (typeof plan)[number][] = [];
    let failure: Error | undefined;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        await ctx.api.categories.updateMonthCategory(planId, month, item.categoryId, { category: { budgeted: item.assignedAfter } });
        applied.push(plan[i]);
      } catch (error) {
        failure = toYnabError(error);
        notApplied.push(...plan.slice(i));
        break;
      }
    }
    if (applied.length > 0) ctx.lookup.invalidate(planId, ["categories"]);

    if (failure) {
      const describe = (rows: (typeof plan)[number][]) => (rows.length ? rows.map((row) => `${row.category} (+${row.amount})`).join(", ") : "none");
      throw new Error(
        `Auto-assign failed partway through and stopped. Applied: ${describe(applied)}. Not applied: ${describe(notApplied)}. ` +
          `Nothing was rolled back; use ynab_assign to adjust any category that still needs it. (${failure.message})`
      );
    }

    const monthAfter = (await ctx.api.months.getPlanMonth(planId, month)).data.month;

    return {
      currency: currency.iso_code,
      month,
      dry_run: false,
      ready_to_assign_before: readyToAssignBefore,
      ready_to_assign_after: fromMilliunits(monthAfter.to_be_budgeted, currency),
      plan,
      total_assigned: fromMilliunits(totalMs, currency),
      ...(rateLimitWarning ? { warning: rateLimitWarning } : {}),
      ...(partialNote ? { note: partialNote } : {}),
    };
  },
});
