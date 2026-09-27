import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as ynab from "ynab";
import { defineTool, runTool, type ToolContext } from "../../tools/defineTool.js";
import { createContext } from "../../context.js";
import { USD } from "../../ynab/money.js";
import { Lookup } from "../../ynab/lookup.js";

const ctx: ToolContext = {
  api: {} as ynab.API,
  planId: (explicit) => explicit ?? "default-plan",
  rateLimit: () => undefined,
  currency: async () => USD,
  lookup: new Lookup({} as ynab.API),
};

const echo = defineTool({
  name: "echo",
  title: "Echo",
  description: "Echoes its input",
  inputSchema: { value: z.string() },
  annotations: { readOnlyHint: true },
  async handler(input, context) {
    if (input.value === "throw-ynab") throw { error: { id: "404.2", name: "resource_not_found", detail: "Resource not found" } };
    if (input.value === "throw") throw new Error("boom");
    return { value: input.value, plan: context.planId() };
  },
});

describe("runTool", () => {
  it("serializes the handler's data", async () => {
    const result = await runTool(echo, { value: "hi" }, ctx);
    expect(result.isError).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({ value: "hi", plan: "default-plan" });
  });

  it("turns thrown errors, including YNAB error bodies, into error results", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ynabResult = await runTool(echo, { value: "throw-ynab" }, ctx);
    expect(ynabResult.isError).toBe(true);
    expect(ynabResult.content[0]).toEqual({ type: "text", text: "Resource not found (YNAB error 404.2)" });
    const plainResult = await runTool(echo, { value: "throw" }, ctx);
    expect(plainResult).toEqual({ isError: true, content: [{ type: "text", text: "boom" }] });
  });
});

describe("createContext", () => {
  const client = { api: {} as ynab.API, rateLimit: () => undefined };

  it("resolves the plan id: explicit, then configured, then last-used", () => {
    expect(createContext({ defaultPlanId: "cfg" }, client).planId("arg")).toBe("arg");
    expect(createContext({ defaultPlanId: "cfg" }, client).planId()).toBe("cfg");
    expect(createContext({}, client).planId()).toBe("last-used");
  });
});
