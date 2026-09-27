import { describe, expect, it } from "vitest";
import { listScheduledTransactions } from "../../../tools/scheduled/listScheduledTransactions.js";
import {
  accountFixture,
  categoryFixture,
  categoryGroupFixture,
  payeeFixture,
  planFixture,
  scheduledTransactionFixture,
  ynabError,
} from "../../fakes/ynab.js";
import { setup } from "../harness.js";

function seedWithSchedule() {
  const account = accountFixture({ name: "Checking" });
  const group = categoryGroupFixture({ name: "Bills" });
  const category = categoryFixture({ category_group_id: group.id, name: "Rent" });
  const landlord = payeeFixture({ name: "Landlord" });
  const rent = scheduledTransactionFixture({
    account_id: account.id,
    date_first: "2024-01-01",
    date_next: "2024-03-01",
    frequency: "monthly",
    amount: -1500000,
    memo: "Rent payment",
    payee_id: landlord.id,
    category_id: category.id,
  });
  const cancelled = scheduledTransactionFixture({
    account_id: account.id,
    date_first: "2024-01-01",
    amount: -50000,
    deleted: true,
  });
  return {
    seed: planFixture({
      accounts: [account],
      categoryGroups: [group],
      categories: [category],
      payees: [landlord],
      scheduledTransactions: [rent, cancelled],
    }),
    rent,
    cancelled,
    account,
    landlord,
    category,
  };
}

describe("ynab_list_scheduled_transactions", () => {
  it("lists scheduled transactions with denormalized names and signed currency amounts, excluding deleted ones", async () => {
    const { seed, rent, cancelled, account, landlord, category } = seedWithSchedule();
    const h = setup(seed);

    const { data } = await h.call(listScheduledTransactions, {});

    expect(data.currency).toBe("USD");
    expect(data.count).toBe(1);
    expect(data.scheduled_transactions.map((t: { id: string }) => t.id)).not.toContain(cancelled.id);
    expect(data.scheduled_transactions[0]).toMatchObject({
      id: rent.id,
      date_first: "2024-01-01",
      date_next: "2024-03-01",
      frequency: "monthly",
      amount: -1500,
      memo: "Rent payment",
      account: account.name,
      payee: landlord.name,
      category: category.name,
    });
  });

  it("sorts by next occurrence date, soonest first", async () => {
    const account = accountFixture({ name: "Checking" });
    const soon = scheduledTransactionFixture({ account_id: account.id, date_first: "2024-01-01", date_next: "2024-02-01", amount: -1000 });
    const later = scheduledTransactionFixture({ account_id: account.id, date_first: "2024-01-01", date_next: "2024-06-01", amount: -2000 });
    const h = setup(planFixture({ accounts: [account], scheduledTransactions: [later, soon] }));

    const { data } = await h.call(listScheduledTransactions, {});

    expect(data.scheduled_transactions.map((t: { id: string }) => t.id)).toEqual([soon.id, later.id]);
  });

  it("filters by account", async () => {
    const checking = accountFixture({ name: "Checking" });
    const savings = accountFixture({ name: "Savings" });
    const checkingSched = scheduledTransactionFixture({ account_id: checking.id, date_first: "2024-01-01", amount: -1000 });
    const savingsSched = scheduledTransactionFixture({ account_id: savings.id, date_first: "2024-01-01", amount: -2000 });
    const h = setup(planFixture({ accounts: [checking, savings], scheduledTransactions: [checkingSched, savingsSched] }));

    const { data } = await h.call(listScheduledTransactions, { account: "Savings" });

    expect(data.scheduled_transactions.map((t: { id: string }) => t.id)).toEqual([savingsSched.id]);
  });

  it("handles a plan with no scheduled transactions", async () => {
    const h = setup(planFixture());
    const { data } = await h.call(listScheduledTransactions, {});
    expect(data).toEqual({ currency: "USD", scheduled_transactions: [], count: 0 });
  });

  it("uses the default plan, or the one given", async () => {
    const h = setup();
    await h.call(listScheduledTransactions, {});
    await h.call(listScheduledTransactions, { planId: "last-used" });
    expect(h.fake.calls.filter((c) => c.method === "scheduledTransactions.getScheduledTransactions").map((c) => c.args[0])).toEqual([
      h.planId,
      "last-used",
    ]);
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("scheduledTransactions.getScheduledTransactions", ynabError("404.2", "resource_not_found", "Resource not found"));
    const result = await h.call(listScheduledTransactions, {});
    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });
});
