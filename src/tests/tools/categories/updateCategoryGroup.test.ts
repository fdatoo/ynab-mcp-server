import { describe, expect, it } from "vitest";
import { updateCategoryGroup } from "../../../tools/categories/updateCategoryGroup.js";
import { categoryGroupFixture, planFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_update_category_group", () => {
  it("renames a category group given by id", async () => {
    const group = categoryGroupFixture({ name: "Everyday Expenses" });
    const h = setup(planFixture({ categoryGroups: [group] }));

    const { data } = await h.call(updateCategoryGroup, { group: group.id, name: "Everyday" });

    expect(data).toEqual({ id: group.id, name: "Everyday" });
    expect(h.fake.calls).toContainEqual({
      method: "categories.updateCategoryGroup",
      args: [h.planId, group.id, { category_group: { name: "Everyday" } }],
    });
  });

  it("resolves the group by its current name", async () => {
    const group = categoryGroupFixture({ name: "Everyday Expenses" });
    const h = setup(planFixture({ categoryGroups: [group] }));

    const { data } = await h.call(updateCategoryGroup, { group: "Everyday Expenses", name: "Everyday" });

    expect(data.id).toBe(group.id);
  });

  it("reports a helpful error for an unknown group", async () => {
    const h = setup(planFixture({ categoryGroups: [categoryGroupFixture({ name: "Everyday Expenses" })] }));
    const result = await h.call(updateCategoryGroup, { group: "Nonexistent", name: "X" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('No category group matches "Nonexistent"');
  });

  it("reports API failures as errors", async () => {
    const group = categoryGroupFixture({ name: "Everyday Expenses" });
    const h = setup(planFixture({ categoryGroups: [group] }));
    h.fake.failNext("categories.updateCategoryGroup", ynabError("429", "too_many_requests", "Too many requests"));
    const result = await h.call(updateCategoryGroup, { group: group.id, name: "Everyday" });
    expect(result).toMatchObject({ isError: true, text: "YNAB's rate limit is exhausted (200 requests per hour per token). Wait before retrying." });
  });
});
