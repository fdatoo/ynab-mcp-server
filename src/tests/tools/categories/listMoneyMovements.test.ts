import { describe, expect, it } from "vitest";
import { listMoneyMovements } from "../../../tools/categories/listMoneyMovements.js";
import { categoryFixture, categoryGroupFixture, moneyMovementFixture, planFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

function seedWithMovements() {
  const group = categoryGroupFixture({ name: "Everyday Expenses" });
  const groceries = categoryFixture({ category_group_id: group.id, name: "Groceries" });
  const dining = categoryFixture({ category_group_id: group.id, name: "Dining Out" });
  const movements = [
    moneyMovementFixture({
      month: "2024-01-01",
      amount: 50000,
      to_category_id: groceries.id,
      moved_at: "2024-01-02T10:00:00Z",
      money_movement_group_id: "grp-1",
    }),
    moneyMovementFixture({
      month: "2024-01-01",
      amount: 10000,
      from_category_id: groceries.id,
      to_category_id: dining.id,
      moved_at: "2024-01-03T10:00:00Z",
      money_movement_group_id: "grp-1",
    }),
    moneyMovementFixture({
      month: "2024-02-01",
      amount: 5000,
      from_category_id: dining.id,
      moved_at: "2024-02-01T09:00:00Z",
      note: "correction",
      performed_by_user_id: "user-1",
    }),
  ];
  return { seed: planFixture({ categoryGroups: [group], categories: [groceries, dining], moneyMovements: movements }), groceries, dining };
}

describe("ynab_list_money_movements", () => {
  it("lists movements newest first, with category names resolved", async () => {
    const h = setup(seedWithMovements().seed);

    const { data } = await h.call(listMoneyMovements, {});

    expect(data.movement_count).toBe(3);
    expect(data.movements.map((m: { from: string; to: string }) => `${m.from} -> ${m.to}`)).toEqual([
      "Dining Out -> Ready to Assign",
      "Groceries -> Dining Out",
      "Ready to Assign -> Groceries",
    ]);
  });

  it("reports amount, note and user when present", async () => {
    const h = setup(seedWithMovements().seed);
    const { data } = await h.call(listMoneyMovements, {});
    const correction = data.movements.find((m: { note?: string }) => m.note === "correction");
    expect(correction).toMatchObject({ amount: 5, note: "correction", user: "user-1" });
  });

  it("groups movements that share a money_movement_group_id", async () => {
    const h = setup(seedWithMovements().seed);
    const { data } = await h.call(listMoneyMovements, {});
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0].id).toBe("grp-1");
    expect(data.groups[0].movements).toHaveLength(2);
  });

  it("filters to one month, using the by-month endpoint", async () => {
    const h = setup(seedWithMovements().seed);

    const { data } = await h.call(listMoneyMovements, { month: "2024-02-01" });

    expect(data.movement_count).toBe(1);
    expect(data.movements[0].from).toBe("Dining Out");
    expect(h.fake.calls).toContainEqual({ method: "money_movements.getMoneyMovementsByMonth", args: [h.planId, "2024-02-01"] });
  });

  it("uses the default plan, or the one given", async () => {
    const h = setup(seedWithMovements().seed);
    await h.call(listMoneyMovements, {});
    await h.call(listMoneyMovements, { planId: "last-used" });
    expect(h.fake.calls.filter((c) => c.method === "money_movements.getMoneyMovements").map((c) => c.args[0])).toEqual([
      h.planId,
      "last-used",
    ]);
  });

  it("reports API failures as errors", async () => {
    const h = setup(seedWithMovements().seed);
    h.fake.failNext("money_movements.getMoneyMovements", ynabError("404.2", "resource_not_found", "Resource not found"));
    const result = await h.call(listMoneyMovements, {});
    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });
});
