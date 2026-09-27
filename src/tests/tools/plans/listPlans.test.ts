import { describe, expect, it } from "vitest";
import { listPlans } from "../../../tools/plans/listPlans.js";
import { ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_list_budgets", () => {
  it("lists every plan visible to the token, with id and name only", async () => {
    const h = setup();
    const secondId = h.fake.addPlan({ name: "Family Plan" });

    const { data } = await h.call(listPlans, {});

    expect(data).toEqual([
      { id: h.planId, name: "Test Plan" },
      { id: secondId, name: "Family Plan" },
    ]);
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
