import { describe, expect, it } from "vitest";
import { budgetSummary } from "../../../tools/months/budgetSummary.js";
import { accountFixture, planFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_budget_summary", () => {
  it("excludes closed and deleted accounts", async () => {
    const h = setup(
      planFixture({
        accounts: [
          accountFixture({ name: "Checking" }),
          accountFixture({ name: "Old Savings", closed: true }),
          accountFixture({ name: "Gone", deleted: true }),
        ],
      })
    );
    const { data } = await h.call(budgetSummary, {});
    expect(data.accounts.map((a: { name: string }) => a.name)).toEqual(["Checking"]);
  });

  it("calls accounts and the month endpoint for the plan, defaulting the month to 'current'", async () => {
    const h = setup();
    await h.call(budgetSummary, {});
    expect(h.fake.calls).toEqual([
      { method: "accounts.getAccounts", args: [h.planId, undefined] },
      { method: "months.getPlanMonth", args: [h.planId, "current"] },
    ]);
  });

  it("passes an explicit month through to the month endpoint", async () => {
    const h = setup();
    const { data } = await h.call(budgetSummary, { month: "2024-02-01" });
    expect(h.fake.calls).toContainEqual({ method: "months.getPlanMonth", args: [h.planId, "2024-02-01"] });
    expect(data.monthBudget.month).toBe("2024-02-01");
  });

  it("uses the default plan, or the one given", async () => {
    const h = setup();
    await h.call(budgetSummary, {});
    await h.call(budgetSummary, { planId: "last-used" });
    expect(h.fake.calls.map((c) => c.args[0])).toEqual([h.planId, h.planId, "last-used", "last-used"]);
  });

  it("returns the accounts and a formatting note alongside the raw month", async () => {
    const h = setup();
    const { data } = await h.call(budgetSummary, {});
    expect(data.note).toBe("Divide all numbers by 1000 to get the balance in dollars.");
    expect(data.monthBudget).toBeDefined();
  });

  it("reports failures fetching accounts as errors", async () => {
    const h = setup();
    h.fake.failNext("accounts.getAccounts", ynabError("404.2", "resource_not_found", "Resource not found"));
    const result = await h.call(budgetSummary, {});
    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });

  it("reports failures fetching the month as errors", async () => {
    const h = setup();
    h.fake.failNext("months.getPlanMonth", ynabError("404.2", "resource_not_found", "Resource not found"));
    const result = await h.call(budgetSummary, {});
    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });
});
