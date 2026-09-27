import { describe, expect, it } from "vitest";
import { getTransactions } from "../../../tools/transactions/getTransactions.js";
import {
  accountFixture,
  categoryFixture,
  categoryGroupFixture,
  payeeFixture,
  planFixture,
  transactionFixture,
  ynabError,
} from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_get_transactions", () => {
  it("lists transactions with mapped fields", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday" });
    const category = categoryFixture({ category_group_id: group.id, name: "Groceries" });
    const payee = payeeFixture({ name: "Corner Grocer" });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [group],
        categories: [category],
        payees: [payee],
        transactions: [
          transactionFixture({
            account_id: account.id,
            date: "2024-01-05",
            amount: -6000,
            payee_id: payee.id,
            category_id: category.id,
            memo: "Weekly shop",
            cleared: "cleared",
            approved: true,
            flag_color: "red",
          }),
        ],
      })
    );

    const { data } = await h.call(getTransactions, {});

    expect(data.transaction_count).toBe(1);
    expect(data.total_available).toBe(1);
    const [txn] = data.transactions;
    expect(txn.date).toBe("2024-01-05");
    expect(txn.amount).toBe("-6.00");
    expect(txn.memo).toBe("Weekly shop");
    expect(txn.approved).toBe(true);
    expect(txn.cleared).toBe("cleared");
    expect(txn.account_name).toBe("Checking");
    expect(txn.payee_name).toBe("Corner Grocer");
    expect(txn.category_name).toBe("Groceries");
    expect(txn.flag_color).toBe("red");
  });

  it("excludes deleted transactions", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;
    await h.fake.api.transactions.deleteTransaction(h.planId, seeded.id);

    const { data } = await h.call(getTransactions, {});

    expect(data).toEqual({ transactions: [], transaction_count: 0, total_available: 0 });
  });

  it("filters by accountId", async () => {
    const checking = accountFixture({ name: "Checking" });
    const savings = accountFixture({ name: "Savings" });
    const h = setup(
      planFixture({
        accounts: [checking, savings],
        transactions: [
          transactionFixture({ account_id: checking.id, date: "2024-01-05", amount: -1000 }),
          transactionFixture({ account_id: savings.id, date: "2024-01-06", amount: -2000 }),
        ],
      })
    );

    const { data } = await h.call(getTransactions, { accountId: checking.id });

    expect(data.transaction_count).toBe(1);
    expect(data.transactions[0].amount).toBe("-1.00");
    expect(h.fake.calls.at(-1)).toMatchObject({
      method: "transactions.getTransactionsByAccount",
      args: [h.planId, checking.id, undefined, undefined, undefined, undefined],
    });
  });

  it("filters by categoryId, including matching split subtransactions", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday" });
    const groceries = categoryFixture({ category_group_id: group.id, name: "Groceries" });
    const dining = categoryFixture({ category_group_id: group.id, name: "Dining Out" });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [group],
        categories: [groceries, dining],
        transactions: [
          transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -6000, category_id: groceries.id }),
          transactionFixture({
            account_id: account.id,
            date: "2024-01-10",
            amount: -12000,
            subtransactions: [
              { amount: -8000, category_id: groceries.id },
              { amount: -4000, category_id: dining.id },
            ],
          }),
        ],
      })
    );

    const { data } = await h.call(getTransactions, { categoryId: groceries.id });

    expect(data.transaction_count).toBe(2);
    expect(data.transactions.every((t: { category_name: string }) => t.category_name === "Groceries")).toBe(true);
    expect(data.transactions.map((t: { amount: string }) => t.amount).sort()).toEqual(["-6.00", "-8.00"]);
  });

  it("filters by payeeId", async () => {
    const account = accountFixture({ name: "Checking" });
    const cafe = payeeFixture({ name: "Cafe" });
    const grocer = payeeFixture({ name: "Grocer" });
    const h = setup(
      planFixture({
        accounts: [account],
        payees: [cafe, grocer],
        transactions: [
          transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, payee_id: cafe.id }),
          transactionFixture({ account_id: account.id, date: "2024-01-06", amount: -2000, payee_id: grocer.id }),
        ],
      })
    );

    const { data } = await h.call(getTransactions, { payeeId: cafe.id });

    expect(data.transaction_count).toBe(1);
    expect(data.transactions[0].payee_name).toBe("Cafe");
  });

  it("filters by type unapproved", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [
          transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, approved: true }),
          transactionFixture({ account_id: account.id, date: "2024-01-06", amount: -2000, approved: false }),
        ],
      })
    );

    const { data } = await h.call(getTransactions, { type: "unapproved" });

    expect(data.transaction_count).toBe(1);
    expect(data.transactions[0].approved).toBe(false);
  });

  it("filters by type uncategorized", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday" });
    const category = categoryFixture({ category_group_id: group.id, name: "Groceries" });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [group],
        categories: [category],
        transactions: [
          transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, category_id: category.id }),
          transactionFixture({ account_id: account.id, date: "2024-01-06", amount: 5000 }),
        ],
      })
    );

    const { data } = await h.call(getTransactions, { type: "uncategorized" });

    expect(data.transaction_count).toBe(1);
    expect(data.transactions[0].category_name).toBeNull();
  });

  it("filters by sinceDate", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [
          transactionFixture({ account_id: account.id, date: "2024-01-01", amount: -1000 }),
          transactionFixture({ account_id: account.id, date: "2024-01-10", amount: -2000 }),
          transactionFixture({ account_id: account.id, date: "2024-01-20", amount: -3000 }),
        ],
      })
    );

    const { data } = await h.call(getTransactions, { sinceDate: "2024-01-10" });

    expect(data.transactions.map((t: { date: string }) => t.date)).toEqual(["2024-01-10", "2024-01-20"]);
  });

  // Not asserting which transactions survive the limit (oldest-first is a
  // known bug, see report), only that the count is capped and the total
  // isn't.
  it("limits the number of transactions returned without affecting total_available", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: Array.from({ length: 5 }, (_, i) =>
          transactionFixture({ account_id: account.id, date: `2024-01-0${i + 1}`, amount: -1000 })
        ),
      })
    );

    const { data } = await h.call(getTransactions, { limit: 2 });

    expect(data.transaction_count).toBe(2);
    expect(data.total_available).toBe(5);
  });

  it("returns an empty list when the plan has no transactions", async () => {
    const h = setup(planFixture({ accounts: [accountFixture({ name: "Checking" })] }));

    const { data } = await h.call(getTransactions, {});

    expect(data).toEqual({ transactions: [], transaction_count: 0, total_available: 0 });
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("transactions.getTransactions", ynabError("404.2", "resource_not_found", "Resource not found"));

    const result = await h.call(getTransactions, {});

    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });

  it("uses the default plan, or the one given", async () => {
    const h = setup();
    await h.call(getTransactions, {});
    await h.call(getTransactions, { planId: "last-used" });

    expect(h.fake.calls.filter((c) => c.method === "transactions.getTransactions").map((c) => c.args[0])).toEqual([
      h.planId,
      "last-used",
    ]);
  });
});
