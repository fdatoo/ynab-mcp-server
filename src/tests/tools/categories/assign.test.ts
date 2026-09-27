import { describe, expect, it } from "vitest";
import { assign } from "../../../tools/categories/assign.js";
import { accountFixture, categoryFixture, categoryGroupFixture, planFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

function minimalSeed() {
  const account = accountFixture({ name: "Checking" });
  const group = categoryGroupFixture({ name: "Everyday Expenses" });
  const category = categoryFixture({ category_group_id: group.id, name: "Groceries", budgetedByMonth: { "2024-03-01": 30000 } });
  return { seed: planFixture({ accounts: [account], categoryGroups: [group], categories: [category] }), category };
}

describe("ynab_assign", () => {
  it("sets the assigned amount, replacing whatever was there", async () => {
    const { seed, category } = minimalSeed();
    const h = setup(seed);

    const { data } = await h.call(assign, { category: category.id, month: "2024-03-01", amount: 75.5, mode: "set" });

    expect(h.fake.calls).toContainEqual({
      method: "categories.updateMonthCategory",
      args: [h.planId, "2024-03-01", category.id, { category: { budgeted: 75500 } }],
    });
    expect(data).toMatchObject({
      currency: "USD",
      category: "Groceries",
      month: "2024-03-01",
      before: { assigned: 30 },
      after: { assigned: 75.5 },
      ready_to_assign: -75.5,
    });
  });

  it("adds to the existing assigned amount", async () => {
    const { seed, category } = minimalSeed();
    const h = setup(seed);

    const { data } = await h.call(assign, { category: category.id, month: "2024-03-01", amount: 10, mode: "add" });

    expect(data).toMatchObject({ before: { assigned: 30 }, after: { assigned: 40 } });
  });

  it("removes from the existing assigned amount", async () => {
    const { seed, category } = minimalSeed();
    const h = setup(seed);

    const { data } = await h.call(assign, { category: category.id, month: "2024-03-01", amount: 10, mode: "remove" });

    expect(data).toMatchObject({ before: { assigned: 30 }, after: { assigned: 20 } });
  });

  it("rejects a remove that would take the assigned amount below zero", async () => {
    const { seed, category } = minimalSeed();
    const h = setup(seed);

    const result = await h.call(assign, { category: category.id, month: "2024-03-01", amount: 100, mode: "remove" });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("below zero");
    // Nothing was written.
    expect(h.fake.calls.some((c) => c.method === "categories.updateMonthCategory")).toBe(false);
  });

  it("resolves the category by name", async () => {
    const { seed, category } = minimalSeed();
    const h = setup(seed);

    await h.call(assign, { category: "Groceries", month: "2024-03-01", amount: 10, mode: "set" });

    expect(h.fake.calls).toContainEqual({
      method: "categories.updateMonthCategory",
      args: [h.planId, "2024-03-01", category.id, { category: { budgeted: 10000 } }],
    });
  });

  it("invalidates the category cache, so a later lookup re-fetches instead of serving stale data", async () => {
    const { seed, category } = minimalSeed();
    const h = setup(seed);
    await h.ctx.lookup.categories(h.planId); // warm the cache
    const callsBefore = h.fake.calls.filter((c) => c.method === "categories.getCategories").length;

    await h.call(assign, { category: category.id, month: "2024-03-01", amount: 50, mode: "set" });
    await h.ctx.lookup.categories(h.planId); // would be served from the (unexpired) cache if not invalidated

    const callsAfter = h.fake.calls.filter((c) => c.method === "categories.getCategories").length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });

  it("uses the default plan, or the one given", async () => {
    const { seed, category } = minimalSeed();
    const h = setup(seed);
    await h.call(assign, { category: category.id, month: "2024-03-01", amount: 10, mode: "set" });
    await h.call(assign, { planId: "last-used", category: category.id, month: "2024-03-01", amount: 10, mode: "set" });
    expect(h.fake.calls.filter((c) => c.method === "categories.getMonthCategoryById").map((c) => c.args[0])).toEqual([
      h.planId,
      "last-used",
    ]);
  });

  it("surfaces a helpful error for an unknown category", async () => {
    const h = setup();
    const result = await h.call(assign, { category: "does-not-exist", month: "2024-03-01", amount: 10, mode: "set" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('No category matches "does-not-exist"');
  });

  it("reports other API failures as errors", async () => {
    const { seed, category } = minimalSeed();
    const h = setup(seed);
    h.fake.failNext("categories.updateMonthCategory", ynabError("429", "too_many_requests", "Too many requests"));
    const result = await h.call(assign, { category: category.id, month: "2024-03-01", amount: 10, mode: "set" });
    expect(result).toMatchObject({ isError: true, text: "YNAB's rate limit is exhausted (200 requests per hour per token). Wait before retrying." });
  });
});
