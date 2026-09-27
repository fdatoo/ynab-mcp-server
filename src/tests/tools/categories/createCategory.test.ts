import { describe, expect, it } from "vitest";
import { createCategory } from "../../../tools/categories/createCategory.js";
import { categoryGroupFixture, planFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_create_category", () => {
  it("creates a category in a group given by id", async () => {
    const group = categoryGroupFixture({ name: "Everyday Expenses" });
    const h = setup(planFixture({ categoryGroups: [group] }));

    const { data } = await h.call(createCategory, { group: group.id, name: "Subscriptions" });

    expect(data).toMatchObject({ name: "Subscriptions", group: "Everyday Expenses" });
    expect(h.fake.calls).toContainEqual({
      method: "categories.createCategory",
      args: [
        h.planId,
        { category: { name: "Subscriptions", category_group_id: group.id, note: undefined, goal_target: undefined, goal_target_date: undefined } },
      ],
    });
  });

  it("resolves the group by name", async () => {
    const group = categoryGroupFixture({ name: "Everyday Expenses" });
    const h = setup(planFixture({ categoryGroups: [group] }));

    const { data } = await h.call(createCategory, { group: "Everyday Expenses", name: "Subscriptions" });

    expect(data.group).toBe("Everyday Expenses");
  });

  it("converts a goal target from currency units to milliunits", async () => {
    const group = categoryGroupFixture({ name: "Goals" });
    const h = setup(planFixture({ categoryGroups: [group] }));

    await h.call(createCategory, { group: group.id, name: "New Roof", goalTarget: 600, goalTargetDate: "2025-01-01" });

    expect(h.fake.calls).toContainEqual({
      method: "categories.createCategory",
      args: [
        h.planId,
        { category: { name: "New Roof", category_group_id: group.id, note: undefined, goal_target: 600000, goal_target_date: "2025-01-01" } },
      ],
    });
  });

  it("invalidates the category cache", async () => {
    const group = categoryGroupFixture({ name: "Everyday Expenses" });
    const h = setup(planFixture({ categoryGroups: [group] }));
    await h.ctx.lookup.categories(h.planId);
    const before = h.fake.calls.filter((c) => c.method === "categories.getCategories").length;

    await h.call(createCategory, { group: group.id, name: "Subscriptions" });
    await h.ctx.lookup.categories(h.planId);

    expect(h.fake.calls.filter((c) => c.method === "categories.getCategories").length).toBeGreaterThan(before);
  });

  it("reports a helpful error for an unknown group", async () => {
    const h = setup(planFixture({ categoryGroups: [categoryGroupFixture({ name: "Everyday Expenses" })] }));
    const result = await h.call(createCategory, { group: "Nonexistent", name: "X" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('No category group matches "Nonexistent"');
  });

  it("reports API failures as errors", async () => {
    const group = categoryGroupFixture({ name: "Everyday Expenses" });
    const h = setup(planFixture({ categoryGroups: [group] }));
    h.fake.failNext("categories.createCategory", ynabError("429", "too_many_requests", "Too many requests"));
    const result = await h.call(createCategory, { group: group.id, name: "Subscriptions" });
    expect(result).toMatchObject({ isError: true, text: "YNAB's rate limit is exhausted (200 requests per hour per token). Wait before retrying." });
  });
});
