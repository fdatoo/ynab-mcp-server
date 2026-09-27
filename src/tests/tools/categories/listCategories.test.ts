import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listCategories } from "../../../tools/categories/listCategories.js";
import { accountFixture, categoryFixture, categoryGroupFixture, planFixture, standardPlan, transactionFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

// standardPlan()'s categories are budgeted for the month the plan is created
// in, and its transactions run January to February 2024.
const JAN_2024 = new Date("2024-01-15T00:00:00Z");

describe("ynab_list_categories", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(JAN_2024);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups categories by category group, excluding hidden and deleted categories", async () => {
    const h = setup(standardPlan().seed);
    const { data } = await h.call(listCategories, {});

    const everyday = data.category_groups.find((g: { name: string }) => g.name === "Everyday Expenses");
    const savings = data.category_groups.find((g: { name: string }) => g.name === "Savings Goals");
    expect(everyday.categories.map((c: { name: string }) => c.name)).toEqual(["Groceries", "Dining Out"]);
    expect(savings.categories.map((c: { name: string }) => c.name)).toEqual(["Vacation"]);
    expect(data.group_count).toBe(2);
    expect(data.category_count).toBe(3);
  });

  it("excludes hidden and deleted groups entirely", async () => {
    const visible = categoryGroupFixture({ name: "Visible" });
    const hidden = categoryGroupFixture({ name: "Hidden", hidden: true });
    const deleted = categoryGroupFixture({ name: "Deleted", deleted: true });
    const h = setup(planFixture({ categoryGroups: [visible, hidden, deleted], categories: [] }));

    const { data } = await h.call(listCategories, {});

    expect(data.category_groups.map((g: { name: string }) => g.name)).toEqual(["Visible"]);
    expect(data.group_count).toBe(1);
  });

  it("includes hidden categories and groups, and their hidden field, only when asked", async () => {
    const h = setup(standardPlan().seed);

    const { data } = await h.call(listCategories, { includeHidden: true });

    const everyday = data.category_groups.find((g: { name: string }) => g.name === "Everyday Expenses");
    expect(everyday.categories.map((c: { name: string }) => c.name)).toContain("Old Hobby");
    const oldHobby = everyday.categories.find((c: { name: string }) => c.name === "Old Hobby");
    expect(oldHobby.hidden).toBe(true);
    const groceries = everyday.categories.find((c: { name: string }) => c.name === "Groceries");
    expect(groceries.hidden).toBe(false);
  });

  it("reports assigned, activity and available in the plan currency", async () => {
    const h = setup(standardPlan().seed);
    const { data } = await h.call(listCategories, {});

    const everyday = data.category_groups.find((g: { name: string }) => g.name === "Everyday Expenses");
    const groceries = everyday.categories.find((c: { name: string }) => c.name === "Groceries");
    expect(groceries).toMatchObject({ assigned: 50, activity: -14, available: 36 });
    expect(everyday.assigned_total).toBe(70);
    expect(data.currency).toBe("USD");
  });

  it("includes a goal summary only for categories with a goal", async () => {
    const group = categoryGroupFixture({ name: "Goals" });
    const withGoal = categoryFixture({
      category_group_id: group.id,
      name: "New Roof",
      goal_type: "NEED",
      goal_target: 60000,
      goal_target_date: "2024-12-01",
      goal_under_funded: 5000,
      goal_percentage_complete: 42,
    });
    const withoutGoal = categoryFixture({ category_group_id: group.id, name: "Misc" });
    const h = setup(planFixture({ categoryGroups: [group], categories: [withGoal, withoutGoal] }));

    const { data } = await h.call(listCategories, {});

    const categories = data.category_groups[0].categories;
    expect(categories.find((c: { name: string }) => c.name === "New Roof").goal).toMatchObject({
      type: "NEED",
      target: 60,
      target_date: "2024-12-01",
      underfunded: 5,
      percent_complete: 42,
    });
    expect(categories.find((c: { name: string }) => c.name === "Misc").goal).toBeUndefined();
  });

  it("fetches numbers for the requested month, not just the current one", async () => {
    const h = setup(standardPlan().seed);
    const { data } = await h.call(listCategories, { month: "2024-02-01" });

    const everyday = data.category_groups.find((g: { name: string }) => g.name === "Everyday Expenses");
    const groceries = everyday.categories.find((c: { name: string }) => c.name === "Groceries");
    // February wasn't budgeted, and February's grocery spending is separate from January's.
    expect(groceries).toMatchObject({ assigned: 0, activity: -5.5, available: -5.5 });
  });

  it("uses the default plan, or the one given", async () => {
    const h = setup();
    await h.call(listCategories, {});
    await h.call(listCategories, { planId: "last-used" });
    expect(h.fake.calls.filter((c) => c.method === "months.getPlanMonth").map((c) => c.args[0])).toEqual([h.planId, "last-used"]);
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("categories.getCategories", ynabError("404.2", "resource_not_found", "Resource not found"));
    const result = await h.call(listCategories, {});
    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });

  it("keeps ordinary categories in groups the API flags internal, as it does YNAB's default groups", async () => {
    const account = accountFixture({ name: "Checking" });
    const bills = categoryGroupFixture({ name: "Bills", internal: true });
    const utilities = categoryFixture({ category_group_id: bills.id, name: "Utilities", internal: false });
    const system = categoryGroupFixture({ name: "Internal Master Category", internal: true });
    const rta = categoryFixture({ category_group_id: system.id, name: "Inflow: Ready to Assign", internal: true });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [bills, system],
        categories: [utilities, rta],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-03-05", amount: -1000, category_id: utilities.id })],
      })
    );
    const { data } = await h.call(listCategories, { month: "2024-03" });
    const text = JSON.stringify(data);
    expect(text).toContain("Utilities");
    expect(text).not.toContain("Ready to Assign\"");
  });
});
