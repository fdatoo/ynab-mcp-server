import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCategory } from "../../../tools/categories/getCategory.js";
import { categoryFixture, categoryGroupFixture, planFixture, standardPlan, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

// standardPlan()'s categories are budgeted for the month the plan is created
// in, so pin the clock to line up with its January transactions.
const JAN_2024 = new Date("2024-01-15T00:00:00Z");

describe("ynab_get_category", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(JAN_2024);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a category's numbers for a month, resolved by name", async () => {
    const { seed, categories } = standardPlan();
    const h = setup(seed);

    const { data } = await h.call(getCategory, { category: "Groceries", month: "2024-01-01" });

    expect(data).toMatchObject({
      currency: "USD",
      month: "2024-01-01",
      id: categories.groceries.id,
      name: "Groceries",
      group: "Everyday Expenses",
      assigned: 50,
      activity: -14,
      available: 36,
      hidden: false,
    });
  });

  it("includes the full goal detail when the category has a goal", async () => {
    const group = categoryGroupFixture({ name: "Goals" });
    const category = categoryFixture({
      category_group_id: group.id,
      name: "New Roof",
      goal_type: "NEED",
      goal_target: 60000,
      goal_target_date: "2024-12-01",
      goal_under_funded: 5000,
      goal_percentage_complete: 42,
      goal_needs_whole_amount: true,
      goal_overall_funded: 25000,
      goal_overall_left: 35000,
    });
    const h = setup(planFixture({ categoryGroups: [group], categories: [category] }));

    const { data } = await h.call(getCategory, { category: "New Roof", month: "2024-01-01" });

    expect(data.goal).toMatchObject({
      type: "NEED",
      target: 60,
      target_date: "2024-12-01",
      underfunded: 5,
      percent_complete: 42,
      needs_whole_amount: true,
      overall_funded: 25,
      overall_left: 35,
    });
  });

  it("omits goal when the category has none", async () => {
    const { seed } = standardPlan();
    const h = setup(seed);
    const { data } = await h.call(getCategory, { category: "Groceries", month: "2024-01-01" });
    expect(data.goal).toBeUndefined();
  });

  it("defaults month to the current month", async () => {
    const { seed, categories } = standardPlan();
    const h = setup(seed);
    await h.call(getCategory, { category: "Groceries" });
    expect(h.fake.calls).toContainEqual({
      method: "categories.getMonthCategoryById",
      args: [h.planId, "2024-01-01", categories.groceries.id],
    });
  });

  it("reports a not-found error for a category name that matches nothing", async () => {
    const h = setup(standardPlan().seed);
    const result = await h.call(getCategory, { category: "Nonexistent" });
    expect(result).toMatchObject({ isError: true });
    expect(result.text).toContain("No category matches");
  });

  it("reports API failures as errors", async () => {
    const { seed } = standardPlan();
    const h = setup(seed);
    h.fake.failNext("categories.getMonthCategoryById", ynabError("429", "too_many_requests", "Too many requests"));
    const result = await h.call(getCategory, { category: "Groceries" });
    expect(result).toMatchObject({ isError: true, text: "YNAB's rate limit is exhausted (200 requests per hour per token). Wait before retrying." });
  });
});
