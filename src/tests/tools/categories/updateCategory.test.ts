import { describe, expect, it } from "vitest";
import { updateCategory } from "../../../tools/categories/updateCategory.js";
import { categoryFixture, categoryGroupFixture, planFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

function seedWithTwoGroups() {
  const groupA = categoryGroupFixture({ name: "Everyday Expenses" });
  const groupB = categoryGroupFixture({ name: "Savings Goals" });
  const category = categoryFixture({ category_group_id: groupA.id, name: "Groceries" });
  return { seed: planFixture({ categoryGroups: [groupA, groupB], categories: [category] }), groupA, groupB, category };
}

describe("ynab_update_category", () => {
  it("renames a category and updates its note", async () => {
    const { seed, category } = seedWithTwoGroups();
    const h = setup(seed);

    const { data } = await h.call(updateCategory, { category: category.id, name: "Groceries & Household", note: "includes cleaning supplies" });

    expect(data.name).toBe("Groceries & Household");
    expect(h.fake.calls).toContainEqual({
      method: "categories.updateCategory",
      args: [
        h.planId,
        category.id,
        { category: { name: "Groceries & Household", note: "includes cleaning supplies", category_group_id: undefined, goal_target: undefined, goal_target_date: undefined } },
      ],
    });
  });

  it("moves a category to another group, resolved by name", async () => {
    const { seed, groupB, category } = seedWithTwoGroups();
    const h = setup(seed);

    const { data } = await h.call(updateCategory, { category: category.id, group: "Savings Goals" });

    expect(data.group).toBe("Savings Goals");
    expect(h.fake.calls).toContainEqual({
      method: "categories.updateCategory",
      args: [h.planId, category.id, { category: { name: undefined, note: undefined, category_group_id: groupB.id, goal_target: undefined, goal_target_date: undefined } }],
    });
  });

  it("sets a goal target, converting from currency units to milliunits", async () => {
    const { seed, category } = seedWithTwoGroups();
    const h = setup(seed);

    await h.call(updateCategory, { category: category.id, goalTarget: 250, goalTargetDate: "2025-06-01" });

    expect(h.fake.calls).toContainEqual({
      method: "categories.updateCategory",
      args: [
        h.planId,
        category.id,
        { category: { name: undefined, note: undefined, category_group_id: undefined, goal_target: 250000, goal_target_date: "2025-06-01" } },
      ],
    });
  });

  it("keeps the current group name in the result when the group is not changed", async () => {
    const { seed, category } = seedWithTwoGroups();
    const h = setup(seed);
    const { data } = await h.call(updateCategory, { category: category.id, name: "Groceries" });
    expect(data.group).toBe("Everyday Expenses");
  });

  it("invalidates the category cache", async () => {
    const { seed, category } = seedWithTwoGroups();
    const h = setup(seed);
    await h.ctx.lookup.categories(h.planId);
    const before = h.fake.calls.filter((c) => c.method === "categories.getCategories").length;

    await h.call(updateCategory, { category: category.id, name: "Renamed" });
    await h.ctx.lookup.categories(h.planId);

    expect(h.fake.calls.filter((c) => c.method === "categories.getCategories").length).toBeGreaterThan(before);
  });

  it("reports a helpful error for an unknown target group", async () => {
    const { seed, category } = seedWithTwoGroups();
    const h = setup(seed);
    const result = await h.call(updateCategory, { category: category.id, group: "Nonexistent" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('No category group matches "Nonexistent"');
  });

  it("surfaces a not-found error for an unknown category", async () => {
    const h = setup(seedWithTwoGroups().seed);
    const result = await h.call(updateCategory, { category: "does-not-exist", name: "X" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('No category matches "does-not-exist"');
  });

  it("reports API failures as errors", async () => {
    const { seed, category } = seedWithTwoGroups();
    const h = setup(seed);
    h.fake.failNext("categories.updateCategory", ynabError("429", "too_many_requests", "Too many requests"));
    const result = await h.call(updateCategory, { category: category.id, name: "Renamed" });
    expect(result).toMatchObject({ isError: true, text: "YNAB's rate limit is exhausted (200 requests per hour per token). Wait before retrying." });
  });
});
