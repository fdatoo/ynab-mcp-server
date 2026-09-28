import { z } from "zod";
import * as ynab from "ynab";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { RateLimit } from "../ynab/client.js";
import type { Currency } from "../ynab/money.js";
import type { Lookup } from "../ynab/lookup.js";
import { toYnabError } from "../ynab/errors.js";

export interface ToolContext {
  api: ynab.API;
  /**
   * The plan to act on: the explicit argument, else the configured default,
   * else "last-used", which the API resolves to the most recently used plan.
   */
  planId(explicit?: string): string;
  rateLimit(): RateLimit | undefined;
  /** The plan's currency format, fetched once per plan. */
  currency(planId: string): Promise<Currency>;
  /** Cached accounts, categories and payees, and name-to-id resolution. */
  lookup: Lookup;
}

export interface Tool<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  annotations: ToolAnnotations;
  /** Returns plain data; runTool serializes it and turns throws into error results. */
  handler(input: z.infer<z.ZodObject<Shape>>, ctx: ToolContext): Promise<unknown>;
}

export function defineTool<Shape extends z.ZodRawShape>(tool: Tool<Shape>): Tool<Shape> {
  return tool;
}

export async function runTool<Shape extends z.ZodRawShape>(
  tool: Tool<Shape>,
  input: z.infer<z.ZodObject<Shape>>,
  ctx: ToolContext
): Promise<CallToolResult> {
  try {
    const data = await tool.handler(input, ctx);
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  } catch (error) {
    console.error(`${tool.name} failed:`, error);
    return { isError: true, content: [{ type: "text", text: toYnabError(error).message }] };
  }
}

/**
 * The schema the server advertises and validates against. It is strict, so a
 * misnamed argument (such as the old budgetId) fails instead of being dropped
 * and silently falling back to the default plan. Optional fields also accept
 * null, which some clients send for "not given"; fields that already accept
 * null keep their own meaning for it (for example "clear the memo").
 */
export function wireSchema<Shape extends z.ZodRawShape>(tool: Tool<Shape>) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(tool.inputSchema) as Array<[string, z.ZodType]>) {
    if (!nullMeansOmitted(field)) shape[key] = field;
    else shape[key] = field.description ? field.nullable().describe(field.description) : field.nullable();
  }
  return z.object(shape).strict();
}

function nullMeansOmitted(field: z.ZodType): boolean {
  return field.safeParse(undefined).success && !field.safeParse(null).success;
}

/**
 * Turns validated wire input into handler input: nulls standing in for
 * "not given" are dropped, then the tool's own schema applies its defaults.
 */
export function toHandlerInput<Shape extends z.ZodRawShape>(tool: Tool<Shape>, input: Record<string, unknown>) {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const field = tool.inputSchema[key] as z.ZodType | undefined;
    if (value === null && field && nullMeansOmitted(field)) continue;
    cleaned[key] = value;
  }
  return z.object(tool.inputSchema).parse(cleaned);
}

