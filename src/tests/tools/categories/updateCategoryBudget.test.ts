import { afterEach, describe, expect, it, vi } from "vitest";
import { updateCategoryBudget } from "../../../tools/categories/updateCategoryBudget.js";
import { accountFixture, categoryFixture, categoryGroupFixture, planFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

const MARCH_2024 = new Date("2024-03-15T00:00:00Z");

function minimalSeed() {
  const account = accountFixture({ name: "Checking" });
  const group = categoryGroupFixture({ name: "Everyday Expenses" });
  const category = categoryFixture({ category_group_id: group.id, name: "Groceries" });
  return { seed: planFixture({ accounts: [account], categoryGroups: [group], categories: [category] }), category };
}

describe("ynab_update_category_budget", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets the budgeted amount for the given month and category, in milliunits", async () => {
    const { seed, category } = minimalSeed();
    const h = setup(seed);

    const { data } = await h.call(updateCategoryBudget, { month: "2024-03-01", categoryId: category.id, budgeted: 75.5 });

    expect(h.fake.calls).toEqual([
      {
        method: "categories.updateMonthCategory",
        args: [h.planId, "2024-03-01", category.id, { category: { budgeted: 75500 } }],
      },
    ]);
    expect(data).toMatchObject({
      success: true,
      category: { id: category.id, name: "Groceries", budgeted: "75.50", activity: "0.00", balance: "75.50" },
      message: "Successfully updated Groceries budget to $75.50",
    });
  });

  it("rounds sub-cent dollar amounts to the nearest milliunit", async () => {
    const { seed, category } = minimalSeed();
    const h = setup(seed);

    await h.call(updateCategoryBudget, { month: "2024-03-01", categoryId: category.id, budgeted: 12.345 });

    expect(h.fake.calls).toEqual([
      { method: "categories.updateMonthCategory", args: [h.planId, "2024-03-01", category.id, { category: { budgeted: 12345 } }] },
    ]);
  });

  it("changes the category's balance seen by a later getCategories call, for the same month", async () => {
    // getCategories reads the "current" month, so pin the clock to the month
    // being budgeted here.
    vi.useFakeTimers();
    vi.setSystemTime(MARCH_2024);

    const { seed, category } = minimalSeed();
    const h = setup(seed);
    await h.call(updateCategoryBudget, { month: "2024-03-01", categoryId: category.id, budgeted: 75.5 });

    const later = await h.fake.api.categories.getCategories(h.planId);
    const updated = later.data.category_groups.flatMap((g) => g.categories).find((c) => c.id === category.id);
    expect(updated).toMatchObject({ budgeted: 75500, balance: 75500 });
  });

  it("uses the default plan, or the one given", async () => {
    const { seed, category } = minimalSeed();
    const h = setup(seed);
    await h.call(updateCategoryBudget, { month: "2024-03-01", categoryId: category.id, budgeted: 10 });
    await h.call(updateCategoryBudget, { planId: "last-used", month: "2024-03-01", categoryId: category.id, budgeted: 10 });
    expect(h.fake.calls.map((c) => c.args[0])).toEqual([h.planId, "last-used"]);
  });

  it("surfaces a not-found error for an unknown category", async () => {
    const h = setup();
    const result = await h.call(updateCategoryBudget, { month: "2024-03-01", categoryId: "does-not-exist", budgeted: 10 });
    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });

  it("reports other API failures as errors", async () => {
    const { seed, category } = minimalSeed();
    const h = setup(seed);
    h.fake.failNext("categories.updateMonthCategory", ynabError("429", "too_many_requests", "Too many requests"));
    const result = await h.call(updateCategoryBudget, { month: "2024-03-01", categoryId: category.id, budgeted: 10 });
    expect(result).toMatchObject({ isError: true, text: "YNAB's rate limit is exhausted (200 requests per hour per token). Wait before retrying." });
  });
});
