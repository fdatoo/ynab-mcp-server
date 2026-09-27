import { describe, expect, it } from "vitest";
import { listPlans } from "../../../tools/plans/listPlans.js";
import { ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_list_plans", () => {
  it("lists every plan visible to the token, with id, name, last_modified_on and currency", async () => {
    const h = setup();
    const secondId = h.fake.addPlan({ name: "Family Plan", last_modified_on: "2024-05-01T12:00:00Z" });

    const { data } = await h.call(listPlans, {});

    expect(data.plans).toEqual([
      { id: h.planId, name: "Test Plan", last_modified_on: null, currency: "USD", default: true },
      { id: secondId, name: "Family Plan", last_modified_on: "2024-05-01T12:00:00Z", currency: "USD", default: false },
    ]);
  });

  it("notes when no default is configured, since it may be YNAB's last-used plan", async () => {
    const h = setup();
    // The harness always configures a default plan; simulate the unconfigured case directly.
    const ctxWithoutDefault = { ...h.ctx, planId: (explicit?: string) => explicit || "last-used" };
    const { runTool } = await import("../../../tools/defineTool.js");
    const result = await runTool(listPlans, {}, ctxWithoutDefault);
    const data = JSON.parse((result.content[0] as { text: string }).text);

    expect(data.plans.every((p: { default: boolean }) => p.default === false)).toBe(true);
    expect(data.note).toMatch(/last plan used/);
  });

  it("calls getPlans with no arguments, not scoped to any single plan", async () => {
    const h = setup();
    await h.call(listPlans, {});
    expect(h.fake.calls).toEqual([{ method: "plans.getPlans", args: [undefined] }]);
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("plans.getPlans", ynabError("429", "too_many_requests", "Too many requests"));
    const result = await h.call(listPlans, {});
    expect(result).toMatchObject({ isError: true, text: "YNAB's rate limit is exhausted (200 requests per hour per token). Wait before retrying." });
  });
});
