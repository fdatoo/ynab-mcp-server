import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listMonths } from "../../../tools/months/listMonths.js";
import { accountFixture, categoryFixture, categoryGroupFixture, planFixture, transactionFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

// "current" resolves through Date.now(), so pin the clock to keep the seeded
// month's numbers deterministic.
const JAN_2024 = new Date("2024-01-15T00:00:00Z");

describe("ynab_list_months", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(JAN_2024);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function seed() {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday Expenses" });
    const groceries = categoryFixture({ category_group_id: group.id, name: "Groceries", budgetedByMonth: { "2024-01-01": 50000 } });
    return planFixture({
      accounts: [account],
      categoryGroups: [group],
      categories: [groceries],
      transactions: [
        transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -6000, category_id: groceries.id }),
        transactionFixture({ account_id: account.id, date: "2024-02-10", amount: 200000, payee_name: "Employer" }),
      ],
    });
  }

  it("lists every month touched by budgeting or transactions, in the plan currency", async () => {
    const h = setup(seed());

    const { data } = await h.call(listMonths, {});

    expect(data.currency).toBe("USD");
    expect(data.month_count).toBe(2);
    const january = data.months.find((m: { month: string }) => m.month === "2024-01-01");
    const february = data.months.find((m: { month: string }) => m.month === "2024-02-01");
    expect(january).toMatchObject({ income: 0, assigned: 50, activity: -6, ready_to_assign: -50 });
    expect(february).toMatchObject({ income: 200, assigned: 0, activity: 0, ready_to_assign: 200 });
  });

  it("trims the list to sinceMonth", async () => {
    const h = setup(seed());
    const { data } = await h.call(listMonths, { sinceMonth: "2024-02-01" });
    expect(data.months.map((m: { month: string }) => m.month)).toEqual(["2024-02-01"]);
  });

  it("uses the default plan, or the one given", async () => {
    const h = setup();
    await h.call(listMonths, {});
    await h.call(listMonths, { planId: "last-used" });
    expect(h.fake.calls.filter((c) => c.method === "months.getPlanMonths").map((c) => c.args[0])).toEqual([h.planId, "last-used"]);
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("months.getPlanMonths", ynabError("404.2", "resource_not_found", "Resource not found"));
    const result = await h.call(listMonths, {});
    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });
});
