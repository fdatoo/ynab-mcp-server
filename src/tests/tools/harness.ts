import { vi } from "vitest";
import type { z } from "zod";
import { createContext } from "../../context.js";
import { runTool, toHandlerInput, wireSchema, type Tool, type ToolContext } from "../../tools/defineTool.js";
import { FakeYnab, resetIds, standardPlan, type PlanSeed } from "../fakes/ynab.js";

export interface Harness {
  fake: FakeYnab;
  planId: string;
  ctx: ToolContext;
  /** Runs a tool the way the server does. Returns the parsed JSON, or the error text when isError. */
  call<Shape extends z.ZodRawShape>(
    tool: Tool<Shape>,
    input: z.input<z.ZodObject<Shape>>
  ): Promise<{ isError: boolean; data: any; text: string }>;
}

/**
 * A fresh fake with one plan, wired through the real createContext so tests
 * exercise the same plan and currency resolution as production. The plan is
 * the configured default, as YNAB_PLAN_ID would make it.
 */
export function setup(seed: PlanSeed = standardPlan().seed): Harness {
  resetIds();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const fake = new FakeYnab();
  const planId = fake.addPlan(seed);
  const ctx = createContext({ defaultPlanId: planId }, { api: fake.api, rateLimit: () => undefined });
  return {
    fake,
    planId,
    ctx,
    async call(tool, input) {
      // Validate and normalize exactly as the server does before invoking the tool.
      const wire = wireSchema(tool).parse(input) as Record<string, unknown>;
      const result = await runTool(tool, toHandlerInput(tool, wire), ctx);
      const text = (result.content[0] as { text: string }).text;
      const isError = result.isError === true;
      return { isError, text, data: isError ? undefined : JSON.parse(text) };
    },
  };
}
