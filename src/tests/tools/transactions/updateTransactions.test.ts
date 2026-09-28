import { describe, expect, it } from "vitest";
import { updateTransactions } from "../../../tools/transactions/updateTransactions.js";
import { accountFixture, categoryFixture, categoryGroupFixture, payeeFixture, planFixture, transactionFixture } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_update_transactions", () => {
  it("updates only the given fields, leaving others unchanged, in one API call", async () => {
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
            amount: -5000,
            category_id: category.id,
            payee_id: payee.id,
            memo: "Old memo",
            cleared: "cleared",
            approved: true,
          }),
        ],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(updateTransactions, { transactions: [{ id: seeded.id, memo: "New memo" }] });

    expect(data.updated[0]).toMatchObject({ memo: "New memo", amount: -5, category: "Groceries", payee: "Corner Grocer", cleared: "cleared" });
    expect(h.fake.calls.filter((c) => c.method === "transactions.updateTransactions")).toHaveLength(1);
  });

  it("changes the amount, given a direction", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({ accounts: [account], transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 })] })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(updateTransactions, {
      transactions: [{ id: seeded.id, amount: 25, direction: "outflow" }],
    });

    expect(data.updated[0].amount).toBe(-25);
  });

  it("rejects an amount without a direction, and a direction without an amount", async () => {
    const h = setup();
    const withoutDirection = await h.call(updateTransactions, { transactions: [{ id: "txn-1", amount: 5 } as never] });
    expect(withoutDirection).toMatchObject({ isError: true });
    expect(withoutDirection.text).toMatch(/amount and direction must be given together/);

    const withoutAmount = await h.call(updateTransactions, { transactions: [{ id: "txn-1", direction: "outflow" } as never] });
    expect(withoutAmount.text).toMatch(/amount and direction must be given together/);
  });

  it("moves a transaction to a different account", async () => {
    const checking = accountFixture({ name: "Checking" });
    const savings = accountFixture({ name: "Savings" });
    const h = setup(
      planFixture({
        accounts: [checking, savings],
        transactions: [transactionFixture({ account_id: checking.id, date: "2024-01-05", amount: -1000 })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, checking.id)).data.transactions;

    const { data } = await h.call(updateTransactions, { transactions: [{ id: seeded.id, account: "Savings" }] });

    expect(data.updated[0].account).toBe("Savings");
  });

  it("sets the payee by name, creating it when new, and lists it under new_payees", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({ accounts: [account], transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -5000 })] })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(updateTransactions, { transactions: [{ id: seeded.id, payee: "Brand New Bakery" }] });

    expect(data.updated[0].payee).toBe("Brand New Bakery");
    expect(data.new_payees).toEqual(["Brand New Bakery"]);
  });

  it("turns a transaction into a transfer", async () => {
    const checking = accountFixture({ name: "Checking" });
    const savings = accountFixture({ name: "Savings" });
    const h = setup(
      planFixture({
        accounts: [checking, savings],
        transactions: [transactionFixture({ account_id: checking.id, date: "2024-01-05", amount: -5000 })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, checking.id)).data.transactions;

    const { data } = await h.call(updateTransactions, { transactions: [{ id: seeded.id, transferToAccount: "Savings" }] });

    expect(data.updated[0].transfer_account_id).toBe(savings.id);
  });

  it("rejects giving both a payee and a transferToAccount", async () => {
    const h = setup();
    const result = await h.call(updateTransactions, {
      transactions: [{ id: "txn-1", payee: "Employer", transferToAccount: "Checking" }],
    });
    expect(result.text).toMatch(/either payee or transferToAccount/);
  });

  it("clears category, memo and flagColor with null, and leaves them alone when omitted", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday" });
    const category = categoryFixture({ category_group_id: group.id, name: "Groceries" });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [group],
        categories: [category],
        transactions: [
          transactionFixture({
            account_id: account.id,
            date: "2024-01-05",
            amount: -1000,
            category_id: category.id,
            memo: "keepsake",
            flag_color: "blue" as never,
          }),
        ],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(updateTransactions, {
      transactions: [{ id: seeded.id, category: null, memo: null, flagColor: null }],
    });

    expect(data.updated[0]).toMatchObject({ category: null, memo: null, flag_color: null });
  });

  it("changes the category by name", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday" });
    const groceries = categoryFixture({ category_group_id: group.id, name: "Groceries" });
    const dining = categoryFixture({ category_group_id: group.id, name: "Dining Out" });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [group],
        categories: [groceries, dining],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, category_id: groceries.id })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(updateTransactions, { transactions: [{ id: seeded.id, category: "Dining Out" }] });

    expect(data.updated[0].category).toBe("Dining Out");
  });

  it("converts a plain transaction into a split whose lines add up", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday" });
    const groceries = categoryFixture({ category_group_id: group.id, name: "Groceries" });
    const dining = categoryFixture({ category_group_id: group.id, name: "Dining Out" });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [group],
        categories: [groceries, dining],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -120000 })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(updateTransactions, {
      transactions: [
        {
          id: seeded.id,
          splits: [
            { amount: 80, category: "Groceries" },
            { amount: 40, category: "Dining Out" },
          ],
        },
      ],
    });

    expect(data.updated[0]).toMatchObject({
      category: "Split",
      amount: -120,
      subtransactions: [
        { amount: -80, category: "Groceries" },
        { amount: -40, category: "Dining Out" },
      ],
    });
  });

  it("uses the new amount, not the old one, to check split lines when both are given", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({ accounts: [account], transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 })] })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const result = await h.call(updateTransactions, {
      transactions: [
        { id: seeded.id, amount: 30, direction: "outflow", splits: [{ amount: 20 }, { amount: 5 }] },
      ],
    });

    expect(result.text).toMatch(/split lines add up to -25, but the transaction amount is -30/);
  });

  it("rejects splits on a transaction that is already a split, without writing", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday" });
    const category = categoryFixture({ category_group_id: group.id, name: "Groceries" });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [group],
        categories: [category],
        transactions: [
          transactionFixture({
            account_id: account.id,
            date: "2024-01-05",
            amount: -12000,
            subtransactions: [{ amount: -12000, category_id: category.id }],
          }),
        ],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const result = await h.call(updateTransactions, {
      transactions: [{ id: seeded.id, splits: [{ amount: 60 }, { amount: 60 }] }],
    });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/already a split.*delete it and recreate it/i);
    expect(h.fake.calls.some((c) => c.method === "transactions.updateTransactions")).toBe(false);
  });

  it("rejects a category alongside splits", async () => {
    const h = setup();
    const result = await h.call(updateTransactions, {
      transactions: [{ id: "txn-1", category: "Groceries", splits: [{ amount: 1 }, { amount: 1 }] }],
    });
    expect(result.text).toMatch(/categories on its lines/);
  });

  it("reports ids missing from the response as not_updated", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({ accounts: [account], transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 })] })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(updateTransactions, {
      transactions: [{ id: seeded.id, memo: "a" }, { id: "does-not-exist", memo: "b" }],
    });

    expect(data.updated).toHaveLength(1);
    expect(data.not_updated).toEqual(["does-not-exist"]);
  });

  it("updates a batch of up to 100 transactions in one API call", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [
          transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 }),
          transactionFixture({ account_id: account.id, date: "2024-01-06", amount: -2000 }),
        ],
      })
    );
    const seeded = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(updateTransactions, {
      transactions: seeded.map((t) => ({ id: t.id, approved: true })),
    });

    expect(data.updated).toHaveLength(2);
    expect(h.fake.calls.filter((c) => c.method === "transactions.updateTransactions")).toHaveLength(1);
  });

  it("uses the default plan, or the one given", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({ accounts: [account], transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 })] })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    await h.call(updateTransactions, { transactions: [{ id: seeded.id, memo: "a" }] });
    await h.call(updateTransactions, { transactions: [{ id: seeded.id, memo: "b" }], planId: "last-used" });

    expect(h.fake.calls.filter((c) => c.method === "transactions.updateTransactions").map((c) => c.args[0])).toEqual([h.planId, "last-used"]);
  });

  it("skips a guarded item that was categorized in the meantime, while applying the others", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday" });
    const category = categoryFixture({ category_group_id: group.id, name: "Groceries" });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [group],
        categories: [category],
        transactions: [
          transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 }),
          transactionFixture({ account_id: account.id, date: "2024-01-06", amount: -2000 }),
        ],
      })
    );
    const seeded = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;
    const [staleItem, freshItem] = seeded;

    // Someone else categorizes staleItem between the read that produced this
    // request and the call to apply it.
    await h.fake.api.transactions.updateTransaction(h.planId, staleItem.id, { transaction: { category_id: category.id } as never });

    const { data } = await h.call(updateTransactions, {
      transactions: [
        { id: staleItem.id, ifUncategorized: true, memo: "should be skipped" },
        { id: freshItem.id, ifUncategorized: true, memo: "should apply" },
      ],
    });

    expect(data.skipped_changed).toEqual([{ id: staleItem.id, reason: expect.stringContaining("no longer uncategorized") }]);
    expect(data.updated).toHaveLength(1);
    expect(data.updated[0]).toMatchObject({ id: freshItem.id, memo: "should apply" });
    expect(h.fake.calls.filter((c) => c.method === "transactions.updateTransactions")).toHaveLength(1);
  });

  it("makes no write when every guarded item was changed in the meantime", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday" });
    const category = categoryFixture({ category_group_id: group.id, name: "Groceries" });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [group],
        categories: [category],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;
    await h.fake.api.transactions.updateTransaction(h.planId, seeded.id, { transaction: { category_id: category.id } as never });

    const { data } = await h.call(updateTransactions, {
      transactions: [{ id: seeded.id, ifUncategorized: true, memo: "should be skipped" }],
    });

    expect(data.skipped_changed).toEqual([{ id: seeded.id, reason: expect.stringContaining("no longer uncategorized") }]);
    expect(data.updated).toEqual([]);
    expect(h.fake.calls.some((c) => c.method === "transactions.updateTransactions")).toBe(false);
  });

  it("applies a guarded item normally when it is still uncategorized, with one extra read", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday" });
    const category = categoryFixture({ category_group_id: group.id, name: "Groceries" });
    const h = setup(
      planFixture({
        accounts: [account],
        categoryGroups: [group],
        categories: [category],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(updateTransactions, {
      transactions: [{ id: seeded.id, ifUncategorized: true, category: "Groceries" }],
    });

    expect(data.updated[0]).toMatchObject({ category: "Groceries" });
    expect(data.skipped_changed).toBeUndefined();
    expect(h.fake.calls.filter((c) => c.method === "transactions.getTransactions")).toHaveLength(1);
  });

  it("does not make the extra read when no item is guarded", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({ accounts: [account], transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 })] })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    await h.call(updateTransactions, { transactions: [{ id: seeded.id, memo: "a" }] });

    expect(h.fake.calls.some((c) => c.method === "transactions.getTransactions")).toBe(false);
  });

  it("names the offending item when a name does not resolve", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({ accounts: [account], transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 })] })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const result = await h.call(updateTransactions, { transactions: [{ id: seeded.id, category: "Nope" }] });

    expect(result).toMatchObject({ isError: true });
    expect(result.text).toMatch(/No category matches "Nope"/);
  });

  it("refuses a credit card payment category, which YNAB would silently drop", async () => {
    const checking = accountFixture({ name: "Checking" });
    const payments = categoryGroupFixture({ name: "Credit Card Payments", internal: true });
    const visa = categoryFixture({ category_group_id: payments.id, name: "Visa" });
    const h = setup(
      planFixture({
        accounts: [checking],
        categoryGroups: [payments],
        categories: [visa],
        transactions: [transactionFixture({ account_id: checking.id, date: "2024-02-15", amount: -5000 })],
      })
    );
    const [txn] = (await h.fake.api.transactions.getTransactions(h.planId)).data.transactions;
    const result = await h.call(updateTransactions, { transactions: [{ id: txn.id, category: "Visa" }] });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/credit card payment category/);
  });
});
