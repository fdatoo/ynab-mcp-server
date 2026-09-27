import { describe, expect, it, vi } from "vitest";
import { moveMoney } from "../../../tools/categories/moveMoney.js";
import { accountFixture, categoryFixture, categoryGroupFixture, planFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

function twoCategorySeed() {
  const account = accountFixture({ name: "Checking" });
  const group = categoryGroupFixture({ name: "Everyday Expenses" });
  const groceries = categoryFixture({ category_group_id: group.id, name: "Groceries", budgetedByMonth: { "2024-03-01": 50000 } });
  const dining = categoryFixture({ category_group_id: group.id, name: "Dining Out", budgetedByMonth: { "2024-03-01": 10000 } });
  return {
    seed: planFixture({ accounts: [account], categoryGroups: [group], categories: [groceries, dining] }),
    groceries,
    dining,
  };
}

describe("ynab_move_money", () => {
  it("lowers the source's assigned amount and raises the target's", async () => {
    const { seed, groceries, dining } = twoCategorySeed();
    const h = setup(seed);

    const { data } = await h.call(moveMoney, { from: groceries.id, to: dining.id, amount: 20, month: "2024-03-01" });

    expect(data.from).toMatchObject({ name: "Groceries", before: { assigned: 50 }, after: { assigned: 30 } });
    expect(data.to).toMatchObject({ name: "Dining Out", before: { assigned: 10 }, after: { assigned: 30 } });
    expect(data.warning).toBeUndefined();
  });

  it("resolves categories by name", async () => {
    const { seed, groceries, dining } = twoCategorySeed();
    const h = setup(seed);

    await h.call(moveMoney, { from: "Groceries", to: "Dining Out", amount: 20, month: "2024-03-01" });

    expect(h.fake.calls).toContainEqual({
      method: "categories.updateMonthCategory",
      args: [h.planId, "2024-03-01", groceries.id, { category: { budgeted: 30000 } }],
    });
    expect(h.fake.calls).toContainEqual({
      method: "categories.updateMonthCategory",
      args: [h.planId, "2024-03-01", dining.id, { category: { budgeted: 30000 } }],
    });
  });

  it("moving from Ready to Assign only raises the target category", async () => {
    const { seed, dining } = twoCategorySeed();
    const h = setup(seed);

    const { data } = await h.call(moveMoney, { from: "Ready to Assign", to: dining.id, amount: 15, month: "2024-03-01" });

    expect(data.from).toEqual({ name: "Ready to Assign" });
    expect(data.to).toMatchObject({ name: "Dining Out", before: { assigned: 10 }, after: { assigned: 25 } });
    expect(h.fake.calls.filter((c) => c.method === "categories.updateMonthCategory")).toHaveLength(1);
  });

  it("moving to Ready to Assign only lowers the source category", async () => {
    const { seed, groceries } = twoCategorySeed();
    const h = setup(seed);

    const { data } = await h.call(moveMoney, { from: groceries.id, to: "Ready to Assign", amount: 15, month: "2024-03-01" });

    expect(data.to).toEqual({ name: "Ready to Assign" });
    expect(data.from).toMatchObject({ name: "Groceries", before: { assigned: 50 }, after: { assigned: 35 } });
    expect(h.fake.calls.filter((c) => c.method === "categories.updateMonthCategory")).toHaveLength(1);
  });

  it("rejects moving from Ready to Assign to itself", async () => {
    const h = setup(twoCategorySeed().seed);
    const result = await h.call(moveMoney, { from: "Ready to Assign", to: "ready to assign", amount: 10, month: "2024-03-01" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("cannot both be Ready to Assign");
  });

  it("rejects moving a category to itself", async () => {
    const { seed, groceries } = twoCategorySeed();
    const h = setup(seed);
    const result = await h.call(moveMoney, { from: groceries.id, to: groceries.id, amount: 10, month: "2024-03-01" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("same category");
  });

  it("warns when the source's available balance goes negative", async () => {
    const { seed, groceries, dining } = twoCategorySeed();
    const h = setup(seed);

    const { data } = await h.call(moveMoney, { from: groceries.id, to: dining.id, amount: 60, month: "2024-03-01" });

    expect(data.from.after.available).toBeLessThan(0);
    expect(data.warning).toContain("negative");
  });

  it("reverts the source when raising the target fails, and says so in the error", async () => {
    const { seed, groceries, dining } = twoCategorySeed();
    const h = setup(seed);
    const original = h.ctx.api.categories.updateMonthCategory.bind(h.ctx.api.categories);
    let calls = 0;
    vi.spyOn(h.ctx.api.categories, "updateMonthCategory").mockImplementation((...args: Parameters<typeof original>) => {
      calls += 1;
      if (calls === 2) return Promise.reject(ynabError("429", "too_many_requests", "Too many requests"));
      return original(...args);
    });

    const result = await h.call(moveMoney, { from: groceries.id, to: dining.id, amount: 20, month: "2024-03-01" });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("reverted");

    const after = await h.fake.api.categories.getMonthCategoryById(h.planId, "2024-03-01", groceries.id);
    expect(after.data.category.budgeted).toBe(50000);
  });

  it("states exactly what was left changed when the revert also fails", async () => {
    const { seed, groceries, dining } = twoCategorySeed();
    const h = setup(seed);
    const original = h.ctx.api.categories.updateMonthCategory.bind(h.ctx.api.categories);
    let calls = 0;
    vi.spyOn(h.ctx.api.categories, "updateMonthCategory").mockImplementation((...args: Parameters<typeof original>) => {
      calls += 1;
      if (calls >= 2) return Promise.reject(ynabError("429", "too_many_requests", "Too many requests"));
      return original(...args);
    });

    const result = await h.call(moveMoney, { from: groceries.id, to: dining.id, amount: 20, month: "2024-03-01" });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("also failed");
    expect(result.text).toContain("Groceries");
    expect(result.text).toContain("30"); // the amount it was left at
    expect(result.text).toContain("50"); // the amount it should be restored to
  });

  it("uses the default plan, or the one given", async () => {
    const { seed, groceries, dining } = twoCategorySeed();
    const h = setup(seed);
    await h.call(moveMoney, { from: groceries.id, to: dining.id, amount: 5, month: "2024-03-01" });
    await h.call(moveMoney, { planId: "last-used", from: groceries.id, to: dining.id, amount: 5, month: "2024-03-01" });
    expect(h.fake.calls.filter((c) => c.method === "categories.getMonthCategoryById").map((c) => c.args[0])).toEqual([
      h.planId,
      h.planId,
      "last-used",
      "last-used",
    ]);
  });

  it("surfaces a not-found error for an unknown category", async () => {
    const h = setup(twoCategorySeed().seed);
    const result = await h.call(moveMoney, { from: "does-not-exist", to: "Ready to Assign", amount: 10, month: "2024-03-01" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('No category matches "does-not-exist"');
  });
});
