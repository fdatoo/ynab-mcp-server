import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listCategories } from "../../../tools/categories/listCategories.js";
import { categoryFixture, categoryGroupFixture, planFixture, standardPlan, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

// Category balances are computed for the "current" month, so pin the clock to
// line up with standardPlan()'s January/February transactions.
const JAN_2024 = new Date("2024-01-15T00:00:00Z");

describe("ynab_list_categories", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(JAN_2024);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups categories, excluding hidden and deleted categories within a visible group", async () => {
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

  it("formats budgeted, activity and balance in dollars", async () => {
    const h = setup(standardPlan().seed);
    const { data } = await h.call(listCategories, {});

    const everyday = data.category_groups.find((g: { name: string }) => g.name === "Everyday Expenses");
    const groceries = everyday.categories.find((c: { name: string }) => c.name === "Groceries");
    expect(groceries).toMatchObject({ budgeted: "50.00", activity: "-14.00", balance: "36.00", goal_target: null });
  });

  it("passes through goal fields, formatting the target in dollars", async () => {
    const group = categoryGroupFixture({ name: "Goals" });
    const category = categoryFixture({
      category_group_id: group.id,
      name: "New Roof",
      goal_type: "NEED",
      goal_target: 60000,
      goal_percentage_complete: 42,
    });
    const h = setup(planFixture({ categoryGroups: [group], categories: [category] }));

    const { data } = await h.call(listCategories, {});

    expect(data.category_groups[0].categories[0]).toMatchObject({
      goal_type: "NEED",
      goal_target: "60.00",
      goal_percentage_complete: 42,
    });
  });

  it("uses the default plan, or the one given", async () => {
    const h = setup();
    await h.call(listCategories, {});
    await h.call(listCategories, { planId: "last-used" });
    expect(h.fake.calls.map((c) => c.args[0])).toEqual([h.planId, "last-used"]);
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("categories.getCategories", ynabError("404.2", "resource_not_found", "Resource not found"));
    const result = await h.call(listCategories, {});
    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });
});
