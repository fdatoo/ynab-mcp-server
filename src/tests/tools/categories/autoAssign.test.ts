import { describe, expect, it, vi } from "vitest";
import { autoAssign } from "../../../tools/categories/autoAssign.js";
import { accountFixture, categoryFixture, categoryGroupFixture, planFixture, transactionFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

const MONTH = "2024-03-01";

/**
 * Three eligible goals (Big, Rent, Small, in that shortfall order), a goal
 * that is already fully funded, a hidden category and a category in a hidden
 * group (both excluded), and a category in an internal *group* that is not
 * itself internal (included: the real API marks its own default groups
 * internal too, so group-level internal cannot be a filter). incomeMs is the
 * month's only inflow, so it controls Ready to Assign.
 */
function goalsSeed(incomeMs: number) {
  const account = accountFixture({ name: "Checking" });
  const goalsGroup = categoryGroupFixture({ name: "Goals" });
  const oldGoalsGroup = categoryGroupFixture({ name: "Old Goals", hidden: true });
  const billsGroup = categoryGroupFixture({ name: "Bills", internal: true });

  const bigGoal = categoryFixture({ category_group_id: goalsGroup.id, name: "Big Goal", goal_under_funded: 40000, budgetedByMonth: { [MONTH]: 10000 } });
  const smallGoal = categoryFixture({ category_group_id: goalsGroup.id, name: "Small Goal", goal_under_funded: 20000, budgetedByMonth: { [MONTH]: 0 } });
  const onTrack = categoryFixture({ category_group_id: goalsGroup.id, name: "On Track", goal_under_funded: 0, budgetedByMonth: { [MONTH]: 5000 } });
  const hiddenGoal = categoryFixture({ category_group_id: goalsGroup.id, name: "Hidden Goal", hidden: true, goal_under_funded: 15000, budgetedByMonth: { [MONTH]: 0 } });
  const ghostFund = categoryFixture({ category_group_id: oldGoalsGroup.id, name: "Ghost Fund", goal_under_funded: 12000, budgetedByMonth: { [MONTH]: 0 } });
  const rentGoal = categoryFixture({ category_group_id: billsGroup.id, name: "Rent Goal", goal_under_funded: 25000, budgetedByMonth: { [MONTH]: 0 } });

  const transactions = incomeMs > 0 ? [transactionFixture({ account_id: account.id, date: "2024-03-05", amount: incomeMs, payee_name: "Employer" })] : [];

  return {
    seed: planFixture({
      accounts: [account],
      categoryGroups: [goalsGroup, oldGoalsGroup, billsGroup],
      categories: [bigGoal, smallGoal, onTrack, hiddenGoal, ghostFund, rentGoal],
      transactions,
    }),
    bigGoal,
    smallGoal,
    onTrack,
    hiddenGoal,
    ghostFund,
    rentGoal,
  };
}

describe("ynab_auto_assign", () => {
  it("previews a plan without writing anything, funding the largest shortfall first", async () => {
    const { seed, bigGoal, rentGoal, smallGoal } = goalsSeed(100000);
    const h = setup(seed);

    const { data } = await h.call(autoAssign, { month: MONTH, dryRun: true });

    expect(data.dry_run).toBe(true);
    expect(data.plan.map((item: { category: string }) => item.category)).toEqual(["Goals: Big Goal", "Bills: Rent Goal", "Goals: Small Goal"]);
    expect(data.plan[0]).toMatchObject({ assigned_before: 10, amount: 40, assigned_after: 50, shortfall_before: 40, shortfall_after: 0 });
    expect(data.ready_to_assign_before).toBe(85);
    expect(data.ready_to_assign_after).toBe(0);
    expect(data.total_assigned).toBe(85);
    expect(h.fake.calls.some((c) => c.method === "categories.updateMonthCategory")).toBe(false);
    void bigGoal;
    void rentGoal;
    void smallGoal;
  });

  it("excludes a hidden category and a category in a hidden group, but includes one in a group merely flagged internal", async () => {
    const { seed } = goalsSeed(100000);
    const h = setup(seed);

    const { data } = await h.call(autoAssign, { month: MONTH, dryRun: true });

    const labels = data.plan.map((item: { category: string }) => item.category);
    expect(labels).not.toContain("Goals: Hidden Goal");
    expect(labels).not.toContain("Old Goals: Ghost Fund");
    expect(labels).toContain("Bills: Rent Goal");
  });

  it("partially funds the last category reached when Ready to Assign runs out", async () => {
    const { seed } = goalsSeed(60000);
    const h = setup(seed);

    const { data } = await h.call(autoAssign, { month: MONTH, dryRun: true });

    expect(data.plan.map((item: { category: string }) => item.category)).toEqual(["Goals: Big Goal", "Bills: Rent Goal"]);
    expect(data.plan[1]).toMatchObject({ amount: 5, shortfall_before: 25, shortfall_after: 20 });
    expect(data.total_assigned).toBe(45);
    expect(data.ready_to_assign_after).toBe(0);
    expect(data.note).toContain("runs out");
  });

  it("caps the plan at maxTotal", async () => {
    const { seed } = goalsSeed(100000);
    const h = setup(seed);

    const { data } = await h.call(autoAssign, { month: MONTH, dryRun: true, maxTotal: 30 });

    expect(data.plan).toEqual([expect.objectContaining({ category: "Goals: Big Goal", amount: 30 })]);
    expect(data.total_assigned).toBe(30);
    expect(data.ready_to_assign_after).toBe(55);
  });

  it("restricts the plan to the categories filter", async () => {
    const { seed, smallGoal } = goalsSeed(100000);
    const h = setup(seed);

    const { data } = await h.call(autoAssign, { month: MONTH, dryRun: true, categories: [smallGoal.id] });

    expect(data.plan).toEqual([expect.objectContaining({ category: "Goals: Small Goal", amount: 20 })]);
  });

  it("skips categories in the exclude filter", async () => {
    const { seed, bigGoal } = goalsSeed(100000);
    const h = setup(seed);

    const { data } = await h.call(autoAssign, { month: MONTH, dryRun: true, exclude: [bigGoal.id] });

    expect(data.plan.map((item: { category: string }) => item.category)).toEqual(["Bills: Rent Goal", "Goals: Small Goal"]);
  });

  it("reports nothing to do when Ready to Assign is zero", async () => {
    const { seed } = goalsSeed(0);
    const h = setup(seed);

    const { data } = await h.call(autoAssign, { month: MONTH, dryRun: true });

    expect(data.plan).toEqual([]);
    expect(data.message).toContain("nothing available");
    expect(h.fake.calls.some((c) => c.method === "categories.updateMonthCategory")).toBe(false);
  });

  it("applies the plan, writing each category's new assigned amount", async () => {
    const { seed, bigGoal, rentGoal, smallGoal } = goalsSeed(100000);
    const h = setup(seed);

    const { data } = await h.call(autoAssign, { month: MONTH, dryRun: false });

    expect(data.dry_run).toBe(false);
    expect(data.total_assigned).toBe(85);
    expect(h.fake.calls).toContainEqual({
      method: "categories.updateMonthCategory",
      args: [h.planId, MONTH, bigGoal.id, { category: { budgeted: 50000 } }],
    });
    expect(h.fake.calls).toContainEqual({
      method: "categories.updateMonthCategory",
      args: [h.planId, MONTH, rentGoal.id, { category: { budgeted: 25000 } }],
    });
    expect(h.fake.calls).toContainEqual({
      method: "categories.updateMonthCategory",
      args: [h.planId, MONTH, smallGoal.id, { category: { budgeted: 20000 } }],
    });

    const after = await h.fake.api.categories.getMonthCategoryById(h.planId, MONTH, bigGoal.id);
    expect(after.data.category.budgeted).toBe(50000);
  });

  it("reports exactly what was applied and what was not when a write fails midway", async () => {
    const { seed, bigGoal, rentGoal, smallGoal } = goalsSeed(100000);
    const h = setup(seed);
    // The fake's failNext only fails the very next call to the method, which
    // would be the first (largest-shortfall) write; a spy lets this test fail
    // the second write instead, so there is a genuine applied/not-applied split.
    const original = h.ctx.api.categories.updateMonthCategory.bind(h.ctx.api.categories);
    let calls = 0;
    vi.spyOn(h.ctx.api.categories, "updateMonthCategory").mockImplementation((...args: Parameters<typeof original>) => {
      calls += 1;
      if (calls === 2) return Promise.reject(ynabError("429", "too_many_requests", "Too many requests"));
      return original(...args);
    });

    const result = await h.call(autoAssign, { month: MONTH, dryRun: false });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Big Goal");
    expect(result.text).toContain("Rent Goal");
    expect(result.text).toContain("Small Goal");
    expect(result.text).toContain("ynab_assign");

    const bigAfter = await h.fake.api.categories.getMonthCategoryById(h.planId, MONTH, bigGoal.id);
    expect(bigAfter.data.category.budgeted).toBe(50000); // applied
    const rentAfter = await h.fake.api.categories.getMonthCategoryById(h.planId, MONTH, rentGoal.id);
    expect(rentAfter.data.category.budgeted).toBe(0); // not applied
    void smallGoal;
  });

  it("invalidates the category cache after applying, so a later lookup re-fetches", async () => {
    const { seed } = goalsSeed(100000);
    const h = setup(seed);
    await h.ctx.lookup.categories(h.planId); // warm the cache
    const callsBefore = h.fake.calls.filter((c) => c.method === "categories.getCategories").length;

    await h.call(autoAssign, { month: MONTH, dryRun: false });
    await h.ctx.lookup.categories(h.planId); // would be served from the (unexpired) cache if not invalidated

    const callsAfter = h.fake.calls.filter((c) => c.method === "categories.getCategories").length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });

  it("reports other API failures as errors", async () => {
    const { seed } = goalsSeed(100000);
    const h = setup(seed);
    h.fake.failNext("categories.updateMonthCategory", ynabError("429", "too_many_requests", "Too many requests"));
    const result = await h.call(autoAssign, { month: MONTH, dryRun: false });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("rate limit");
  });
});
