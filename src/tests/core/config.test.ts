import { describe, expect, it } from "vitest";
import { loadConfig } from "../../config.js";

describe("loadConfig", () => {
  it("requires a token", () => {
    expect(() => loadConfig({})).toThrow(/YNAB_API_TOKEN is not set/);
    expect(() => loadConfig({ YNAB_API_TOKEN: "   " })).toThrow(/YNAB_API_TOKEN is not set/);
  });

  it("prefers YNAB_PLAN_ID over YNAB_BUDGET_ID", () => {
    expect(loadConfig({ YNAB_API_TOKEN: "t", YNAB_PLAN_ID: "plan", YNAB_BUDGET_ID: "budget" }).defaultPlanId).toBe("plan");
    expect(loadConfig({ YNAB_API_TOKEN: "t", YNAB_BUDGET_ID: "budget" }).defaultPlanId).toBe("budget");
    expect(loadConfig({ YNAB_API_TOKEN: "t" }).defaultPlanId).toBeUndefined();
  });
});
