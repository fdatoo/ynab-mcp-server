import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { suggestCategories } from "../../../tools/transactions/suggestCategories.js";
import { accountFixture, categoryFixture, categoryGroupFixture, payeeFixture, planFixture, transactionFixture } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_suggest_categories", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-04-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("suggests a payee's only-ever category with high confidence", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday" });
    const groceries = categoryFixture({ category_group_id: group.id, name: "Groceries" });
    const grocer = payeeFixture({ name: "Corner Grocer" });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [group],
        categories: [groceries],
        payees: [grocer],
        transactions: [
          transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, payee_id: grocer.id, category_id: groceries.id }),
          transactionFixture({ account_id: account.id, date: "2024-02-05", amount: -1000, payee_id: grocer.id, category_id: groceries.id }),
          transactionFixture({ account_id: account.id, date: "2024-03-05", amount: -1000, payee_id: grocer.id, category_id: groceries.id }),
          transactionFixture({ account_id: account.id, date: "2024-04-10", amount: -1200, payee_id: grocer.id }),
        ],
      })
    );

    const { data } = await h.call(suggestCategories, {});

    expect(data.total_candidates).toBe(1);
    expect(data.suggestions).toHaveLength(1);
    expect(data.suggestions[0].transaction).toMatchObject({ date: "2024-04-10", amount: -1.2, payee: "Corner Grocer" });
    expect(data.suggestions[0].suggestion).toEqual({
      category_id: groceries.id,
      category: "Everyday: Groceries",
      confidence: "high",
      based_on: { matches: 3, total: 3 },
    });
    expect(data.no_history).toEqual([]);
  });

  it("gives medium confidence for a mostly-consistent payee and low confidence for a thin history", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday" });
    const dining = categoryFixture({ category_group_id: group.id, name: "Dining Out" });
    const groceries = categoryFixture({ category_group_id: group.id, name: "Groceries" });
    const cafe = payeeFixture({ name: "Downtown Cafe" });
    const kiosk = payeeFixture({ name: "Newspaper Kiosk" });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [group],
        categories: [dining, groceries],
        payees: [cafe, kiosk],
        transactions: [
          // Cafe: 3 out of 5 dining, so 60% with at least 2 rows -> medium.
          transactionFixture({ account_id: account.id, date: "2024-01-02", amount: -500, payee_id: cafe.id, category_id: dining.id }),
          transactionFixture({ account_id: account.id, date: "2024-01-10", amount: -500, payee_id: cafe.id, category_id: dining.id }),
          transactionFixture({ account_id: account.id, date: "2024-02-02", amount: -500, payee_id: cafe.id, category_id: dining.id }),
          transactionFixture({ account_id: account.id, date: "2024-02-10", amount: -500, payee_id: cafe.id, category_id: groceries.id }),
          transactionFixture({ account_id: account.id, date: "2024-03-02", amount: -500, payee_id: cafe.id, category_id: groceries.id }),
          transactionFixture({ account_id: account.id, date: "2024-04-01", amount: -600, payee_id: cafe.id }),
          // Kiosk: a single history row is never enough for medium or high.
          transactionFixture({ account_id: account.id, date: "2024-01-20", amount: -300, payee_id: kiosk.id, category_id: dining.id }),
          transactionFixture({ account_id: account.id, date: "2024-04-02", amount: -350, payee_id: kiosk.id }),
        ],
      })
    );

    const { data } = await h.call(suggestCategories, {});

    const byPayee = (payee: string) => data.suggestions.find((s: { transaction: { payee: string } }) => s.transaction.payee === payee);
    expect(byPayee("Downtown Cafe").suggestion).toEqual({
      category_id: dining.id,
      category: "Everyday: Dining Out",
      confidence: "medium",
      based_on: { matches: 3, total: 5 },
    });
    expect(byPayee("Newspaper Kiosk").suggestion).toEqual({
      category_id: dining.id,
      category: "Everyday: Dining Out",
      confidence: "low",
      based_on: { matches: 1, total: 1 },
    });
  });

  it("keeps inflow and outflow history separate for the same payee", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Household" });
    const electric = categoryFixture({ category_group_id: group.id, name: "Electric" });
    const refunds = categoryFixture({ category_group_id: group.id, name: "Refunds" });
    const utility = payeeFixture({ name: "Utility Co" });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [group],
        categories: [electric, refunds],
        payees: [utility],
        transactions: [
          transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -8000, payee_id: utility.id, category_id: electric.id }),
          transactionFixture({ account_id: account.id, date: "2024-02-05", amount: -8000, payee_id: utility.id, category_id: electric.id }),
          transactionFixture({ account_id: account.id, date: "2024-03-05", amount: -8000, payee_id: utility.id, category_id: electric.id }),
          transactionFixture({ account_id: account.id, date: "2024-01-15", amount: 2000, payee_id: utility.id, category_id: refunds.id }),
          transactionFixture({ account_id: account.id, date: "2024-02-15", amount: 2000, payee_id: utility.id, category_id: refunds.id }),
          transactionFixture({ account_id: account.id, date: "2024-03-15", amount: 2000, payee_id: utility.id, category_id: refunds.id }),
          transactionFixture({ account_id: account.id, date: "2024-04-05", amount: -8500, payee_id: utility.id }),
          transactionFixture({ account_id: account.id, date: "2024-04-06", amount: 2000, payee_id: utility.id }),
        ],
      })
    );

    const { data } = await h.call(suggestCategories, {});

    const outflow = data.suggestions.find((s: { transaction: { amount: number } }) => s.transaction.amount < 0);
    const inflow = data.suggestions.find((s: { transaction: { amount: number } }) => s.transaction.amount > 0);
    expect(outflow.suggestion.category).toBe("Household: Electric");
    expect(inflow.suggestion.category).toBe("Household: Refunds");
  });

  it("excludes transfers from both candidates and history", async () => {
    const checking = accountFixture({ name: "Checking" });
    const savings = accountFixture({ name: "Savings" });
    const shop = payeeFixture({ name: "Random Shop" });
    const h = setup(
      planFixture({
        accounts: [checking, savings],
        payees: [shop],
        transactions: [
          // The transfer's own leg on the checking side has no category_id,
          // which is exactly what the fake represents for a transfer.
          transactionFixture({ account_id: checking.id, date: "2024-04-05", amount: -5000, transfer_to_account_id: savings.id }),
          transactionFixture({ account_id: checking.id, date: "2024-04-10", amount: -1000, payee_id: shop.id }),
        ],
      })
    );

    const { data } = await h.call(suggestCategories, {});

    expect(data.total_candidates).toBe(1);
    expect(data.suggestions.map((s: { transaction: { payee: string | null } }) => s.transaction.payee)).toEqual([]);
    expect(data.no_history).toEqual([{ payee: "Random Shop", count: 1 }]);
  });

  it("excludes balance entries from candidates", async () => {
    const account = accountFixture({ name: "Checking" });
    const shop = payeeFixture({ name: "Random Shop" });
    const h = setup(
      planFixture({
        accounts: [account],
        payees: [shop],
        transactions: [
          transactionFixture({ account_id: account.id, date: "2024-04-01", amount: 50000, payee_name: "Starting Balance" }),
          transactionFixture({ account_id: account.id, date: "2024-04-10", amount: -1000, payee_id: shop.id }),
        ],
      })
    );

    const { data } = await h.call(suggestCategories, {});

    expect(data.total_candidates).toBe(1);
    expect(data.no_history).toEqual([{ payee: "Random Shop", count: 1 }]);
  });

  it("excludes split and reconciled transactions from candidates", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday" });
    const groceries = categoryFixture({ category_group_id: group.id, name: "Groceries" });
    const shop = payeeFixture({ name: "Random Shop" });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [group],
        categories: [groceries],
        payees: [shop],
        transactions: [
          transactionFixture({
            account_id: account.id,
            date: "2024-04-02",
            amount: -3000,
            subtransactions: [{ amount: -1500, category_id: groceries.id }, { amount: -1500, category_id: groceries.id }],
          }),
          transactionFixture({ account_id: account.id, date: "2024-04-03", amount: -1000, payee_id: shop.id, cleared: "reconciled" }),
          transactionFixture({ account_id: account.id, date: "2024-04-10", amount: -1000, payee_id: shop.id }),
        ],
      })
    );

    const { data } = await h.call(suggestCategories, {});

    expect(data.total_candidates).toBe(1);
    expect(data.suggestions[0]?.transaction.date ?? data.no_history[0]).toBeTruthy();
    expect(data.no_history).toEqual([{ payee: "Random Shop", count: 1 }]);
  });

  it("lists payees with no history separately, compactly", async () => {
    const account = accountFixture({ name: "Checking" });
    const shop = payeeFixture({ name: "New Shop" });
    const h = setup(
      planFixture({
        accounts: [account],
        payees: [shop],
        transactions: [
          transactionFixture({ account_id: account.id, date: "2024-04-01", amount: -1000, payee_id: shop.id }),
          transactionFixture({ account_id: account.id, date: "2024-04-02", amount: -2000, payee_id: shop.id }),
        ],
      })
    );

    const { data } = await h.call(suggestCategories, {});

    expect(data.suggestions).toEqual([]);
    expect(data.no_history).toEqual([{ payee: "New Shop", count: 2 }]);
  });

  it("makes exactly one transactions request", async () => {
    const account = accountFixture({ name: "Checking" });
    const shop = payeeFixture({ name: "Random Shop" });
    const h = setup(
      planFixture({
        accounts: [account],
        payees: [shop],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-04-10", amount: -1000, payee_id: shop.id })],
      })
    );

    await h.call(suggestCategories, { account: "Checking", historyMonths: 6 });

    const transactionCalls = h.fake.calls.filter((c) => c.method.startsWith("transactions."));
    expect(transactionCalls).toHaveLength(1);
    expect(transactionCalls[0].method).toBe("transactions.getTransactions");
  });
});
