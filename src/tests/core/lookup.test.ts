import { beforeEach, describe, expect, it } from "vitest";
import { Lookup, normalizeName } from "../../ynab/lookup.js";
import {
  FakeYnab,
  accountFixture,
  categoryFixture,
  categoryGroupFixture,
  payeeFixture,
  planFixture,
  resetIds,
} from "../fakes/ynab.js";

function build() {
  resetIds();
  const fake = new FakeYnab();
  const bills = categoryGroupFixture({ name: "Bills" });
  const fun = categoryGroupFixture({ name: "Fun" });
  const planId = fake.addPlan(
    planFixture({
      accounts: [
        accountFixture({ name: "Joint Checking" }),
        accountFixture({ name: "Old Checking", closed: true }),
        accountFixture({ name: "Savings" }),
        accountFixture({ name: "savings", closed: true }),
      ],
      categoryGroups: [bills, fun],
      categories: [
        categoryFixture({ category_group_id: bills.id, name: "🛒 Groceries" }),
        categoryFixture({ category_group_id: bills.id, name: "Misc" }),
        categoryFixture({ category_group_id: fun.id, name: "Misc" }),
        categoryFixture({ category_group_id: fun.id, name: "Retired", deleted: true }),
      ],
      payees: [payeeFixture({ name: "Trader Joe's" }), payeeFixture({ name: "Trader Vic" })],
    })
  );
  let now = 0;
  const lookup = new Lookup(fake.api, { now: () => now, ttlMs: 1000 });
  return { fake, planId, lookup, advance: (ms: number) => (now += ms) };
}

const requests = (fake: FakeYnab, method: string) => fake.calls.filter((c) => c.method === method);

describe("normalizeName", () => {
  it("ignores case, emoji and punctuation", () => {
    expect(normalizeName("🛒 Groceries!")).toBe("groceries");
    expect(normalizeName("Trader Joe's")).toBe("trader joe s");
    expect(normalizeName("Bills :  Misc")).toBe("bills: misc");
  });
});

describe("Lookup", () => {
  let t: ReturnType<typeof build>;
  beforeEach(() => {
    t = build();
  });

  it("resolves by id, exact name, and normalized name", async () => {
    const groceries = await t.lookup.resolveCategory(t.planId, "groceries");
    expect(groceries.name).toBe("🛒 Groceries");
    expect((await t.lookup.resolveCategory(t.planId, groceries.id)).id).toBe(groceries.id);
    expect((await t.lookup.resolveAccount(t.planId, "joint checking")).name).toBe("Joint Checking");
  });

  it("prefers the open account over a closed namesake", async () => {
    const account = await t.lookup.resolveAccount(t.planId, "Savings");
    expect(account).toMatchObject({ name: "Savings", closed: false });
  });

  it("reports ambiguity with candidates, and accepts Group: Name", async () => {
    await expect(t.lookup.resolveCategory(t.planId, "Misc")).rejects.toThrow(/matches more than one category: Bills: Misc .*; Fun: Misc/);
    expect((await t.lookup.resolveCategory(t.planId, "Fun: Misc")).category_group_name).toBe("Fun");
  });

  it("never guesses from a partial name, but suggests", async () => {
    await expect(t.lookup.resolvePayee(t.planId, "Trader")).rejects.toThrow(/No payee matches "Trader". Did you mean: Trader Joe's, Trader Vic\?/);
  });

  it("ignores deleted entries", async () => {
    await expect(t.lookup.resolveCategory(t.planId, "Retired")).rejects.toThrow(/No category matches/);
  });

  it("serves from cache within the TTL, then refreshes with a delta request", async () => {
    await t.lookup.payees(t.planId);
    await t.lookup.payees(t.planId);
    expect(requests(t.fake, "payees.getPayees")).toHaveLength(1);

    await t.fake.api.payees.createPayee(t.planId, { payee: { name: "Costco" } });
    t.advance(1001);
    const names = (await t.lookup.payees(t.planId)).map((p) => p.name);
    expect(names).toContain("Costco");
    const calls = requests(t.fake, "payees.getPayees");
    expect(calls).toHaveLength(2);
    expect(calls[1].args[1]).toBeTypeOf("number");
  });

  it("refreshes once on a miss before giving up", async () => {
    await t.lookup.payees(t.planId);
    await t.fake.api.payees.createPayee(t.planId, { payee: { name: "Costco" } });
    expect((await t.lookup.resolvePayee(t.planId, "costco")).name).toBe("Costco");
    expect(requests(t.fake, "payees.getPayees")).toHaveLength(2);
  });

  it("refreshes after invalidate", async () => {
    await t.lookup.accounts(t.planId);
    t.lookup.invalidate(t.planId, ["accounts"]);
    await t.lookup.accounts(t.planId);
    expect(requests(t.fake, "accounts.getAccounts")).toHaveLength(2);
  });

  it("merges delta category changes into the cached groups", async () => {
    const misc = await t.lookup.resolveCategory(t.planId, "Bills: Misc");
    await t.fake.api.categories.updateCategory(t.planId, misc.id, { category: { name: "Household" } });
    t.lookup.invalidate(t.planId);
    const names = (await t.lookup.categories(t.planId)).map((c) => `${c.category_group_name}: ${c.name}`);
    expect(names.sort()).toEqual(["Bills: Household", "Bills: 🛒 Groceries", "Fun: Misc"]);
  });
});
