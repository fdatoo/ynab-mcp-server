import { describe, expect, it } from "vitest";
import { budgetSummary } from "../../../tools/months/budgetSummary.js";
import { accountFixture, categoryFixture, categoryGroupFixture, planFixture, transactionFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

function seedWithCategories() {
  const account = accountFixture({ name: "Checking" });
  const group = categoryGroupFixture({ name: "Everyday Expenses" });
  const internalGroup = categoryGroupFixture({ name: "Internal Master Category", internal: true });

  const groceries = categoryFixture({ category_group_id: group.id, name: "Groceries", budgetedByMonth: { "2024-03-01": 50000 } });
  const dining = categoryFixture({ category_group_id: group.id, name: "Dining Out", budgetedByMonth: { "2024-03-01": 20000 } });
  const hiddenOverspent = categoryFixture({ category_group_id: group.id, name: "Old Hobby", hidden: true });
  const rent = categoryFixture({
    category_group_id: group.id,
    name: "Rent",
    budgetedByMonth: { "2024-03-01": 20000 },
    goal_type: "NEED",
    goal_target: 150000,
    goal_under_funded: 15000,
  });
  const inflow = categoryFixture({ category_group_id: internalGroup.id, name: "Inflow: Ready to Assign", internal: true });

  return {
    seed: planFixture({
      accounts: [account],
      categoryGroups: [group, internalGroup],
      categories: [groceries, dining, hiddenOverspent, rent, inflow],
      transactions: [
        // Groceries is overspent: 80 of activity against 50 assigned.
        transactionFixture({ account_id: account.id, date: "2024-03-05", amount: -80000, category_id: groceries.id }),
        transactionFixture({ account_id: account.id, date: "2024-03-06", amount: -5000, category_id: dining.id }),
        // The hidden category is also overspent, but must not show up.
        transactionFixture({ account_id: account.id, date: "2024-03-07", amount: -99000, category_id: hiddenOverspent.id }),
        transactionFixture({ account_id: account.id, date: "2024-03-08", amount: -20000, category_id: rent.id }),
      ],
    }),
    account,
    groceries,
    dining,
    hiddenOverspent,
    rent,
    inflow,
  };
}

describe("ynab_budget_summary", () => {
  it("lists overspent categories most negative first, excluding hidden ones", async () => {
    const h = setup(seedWithCategories().seed);
    const { data } = await h.call(budgetSummary, { month: "2024-03-01" });

    expect(data.overspent.map((c: { name: string }) => c.name)).toEqual(["Groceries"]);
    expect(data.overspent[0]).toMatchObject({ name: "Groceries", available: -30 });
  });

  it("lists underfunded goals with the amount needed", async () => {
    const h = setup(seedWithCategories().seed);
    const { data } = await h.call(budgetSummary, { month: "2024-03-01" });

    expect(data.underfunded).toEqual([{ name: "Rent", needed: 15 }]);
  });

  it("lists the top spending categories by activity, excluding the internal group", async () => {
    const h = setup(seedWithCategories().seed);
    const { data } = await h.call(budgetSummary, { month: "2024-03-01" });

    // Old Hobby (hidden) and Inflow: Ready to Assign (internal) are excluded
    // even though both would otherwise qualify.
    expect(data.top_spending.map((c: { name: string }) => c.name)).toEqual(["Groceries", "Rent", "Dining Out"]);
    expect(data.top_spending[0]).toMatchObject({ name: "Groceries", activity: -80 });
  });

  it("reports Ready to Assign, income, assigned and activity totals for the month", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday Expenses" });
    const groceries = categoryFixture({ category_group_id: group.id, name: "Groceries", budgetedByMonth: { "2024-03-01": 50000 } });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [group],
        categories: [groceries],
        transactions: [
          transactionFixture({ account_id: account.id, date: "2024-03-01", amount: 200000, payee_name: "Employer" }),
          transactionFixture({ account_id: account.id, date: "2024-03-05", amount: -10000, category_id: groceries.id }),
        ],
      })
    );

    const { data } = await h.call(budgetSummary, { month: "2024-03-01" });

    expect(data).toMatchObject({ currency: "USD", month: "2024-03-01", ready_to_assign: 150, income: 200, assigned: 50, activity: -10 });
  });

  it("defaults month to 'current' and normalizes it before calling the API", async () => {
    const h = setup(seedWithCategories().seed);
    await h.call(budgetSummary, {});
    expect(h.fake.calls.filter((c) => c.method === "months.getPlanMonth")[0].args[1]).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it("uses the default plan, or the one given", async () => {
    const h = setup(seedWithCategories().seed);
    await h.call(budgetSummary, { month: "2024-03-01" });
    await h.call(budgetSummary, { planId: "last-used", month: "2024-03-01" });
    expect(h.fake.calls.filter((c) => c.method === "months.getPlanMonth").map((c) => c.args[0])).toEqual([h.planId, "last-used"]);
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("months.getPlanMonth", ynabError("404.2", "resource_not_found", "Resource not found"));
    const result = await h.call(budgetSummary, {});
    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });

  it("excludes categories in a hidden group even when the category itself is not flagged hidden", async () => {
    const account = accountFixture({ name: "Checking" });
    const hiddenGroup = categoryGroupFixture({ name: "Retired", hidden: true });
    const stale = categoryFixture({ category_group_id: hiddenGroup.id, name: "Stale", hidden: false });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [hiddenGroup],
        categories: [stale],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-03-05", amount: -1000, category_id: stale.id })],
      })
    );
    const { data } = await h.call(budgetSummary, { month: "2024-03" });
    expect(data.overspent).toEqual([]);
    expect(data.top_spending).toEqual([]);
  });
});
