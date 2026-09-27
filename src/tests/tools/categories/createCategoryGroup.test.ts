import { describe, expect, it } from "vitest";
import { createCategoryGroup } from "../../../tools/categories/createCategoryGroup.js";
import { ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_create_category_group", () => {
  it("creates a category group", async () => {
    const h = setup();

    const { data } = await h.call(createCategoryGroup, { name: "New Group" });

    expect(data.name).toBe("New Group");
    expect(h.fake.calls).toContainEqual({
      method: "categories.createCategoryGroup",
      args: [h.planId, { category_group: { name: "New Group" } }],
    });
  });

  it("invalidates the category cache", async () => {
    const h = setup();
    await h.ctx.lookup.categories(h.planId);
    const before = h.fake.calls.filter((c) => c.method === "categories.getCategories").length;

    await h.call(createCategoryGroup, { name: "New Group" });
    await h.ctx.lookup.categories(h.planId);

    expect(h.fake.calls.filter((c) => c.method === "categories.getCategories").length).toBeGreaterThan(before);
  });

  it("uses the default plan, or the one given", async () => {
    const h = setup();
    await h.call(createCategoryGroup, { name: "A" });
    await h.call(createCategoryGroup, { planId: "last-used", name: "B" });
    expect(h.fake.calls.filter((c) => c.method === "categories.createCategoryGroup").map((c) => c.args[0])).toEqual([
      h.planId,
      "last-used",
    ]);
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("categories.createCategoryGroup", ynabError("429", "too_many_requests", "Too many requests"));
    const result = await h.call(createCategoryGroup, { name: "New Group" });
    expect(result).toMatchObject({ isError: true, text: "YNAB's rate limit is exhausted (200 requests per hour per token). Wait before retrying." });
  });
});
