import { describe, expect, it } from "vitest";
import { getTransaction } from "../../../tools/transactions/getTransaction.js";
import { accountFixture, categoryFixture, categoryGroupFixture, payeeFixture, planFixture, transactionFixture } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_get_transaction", () => {
  it("fetches a transaction by id, formatted", async () => {
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
          transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -5000, payee_id: payee.id, category_id: category.id }),
        ],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(getTransaction, { transactionId: seeded.id });

    expect(data).toMatchObject({
      currency: "USD",
      id: seeded.id,
      date: "2024-01-05",
      amount: -5,
      payee: "Corner Grocer",
      category: "Groceries",
      import_id: null,
      matched_transaction_id: null,
    });
  });

  it("includes split lines", async () => {
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
          transactionFixture({
            account_id: account.id,
            date: "2024-01-05",
            amount: -12000,
            subtransactions: [
              { amount: -8000, category_id: groceries.id },
              { amount: -4000, category_id: dining.id },
            ],
          }),
        ],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(getTransaction, { transactionId: seeded.id });

    expect(data.category).toBe("Split");
    expect(data.subtransactions).toEqual([
      { amount: -8, category: "Groceries", payee: null, memo: null },
      { amount: -4, category: "Dining Out", payee: null, memo: null },
    ]);
  });

  it("includes transfer details for a transfer", async () => {
    const checking = accountFixture({ name: "Checking" });
    const savings = accountFixture({ name: "Savings" });
    const h = setup(
      planFixture({
        accounts: [checking, savings],
        transactions: [transactionFixture({ account_id: checking.id, date: "2024-01-05", amount: -5000, transfer_to_account_id: savings.id })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, checking.id)).data.transactions;

    const { data } = await h.call(getTransaction, { transactionId: seeded.id });

    expect(data.transfer_account_id).toBe(savings.id);
    expect(data.transfer_transaction_id).toBe(seeded.transfer_transaction_id);
  });

  it("reports a 404 for an unknown transaction", async () => {
    const h = setup();

    const result = await h.call(getTransaction, { transactionId: "does-not-exist" });

    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });

  it("uses the default plan, or the one given", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({ accounts: [account], transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 })] })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    await h.call(getTransaction, { transactionId: seeded.id });
    await h.call(getTransaction, { transactionId: seeded.id, planId: "last-used" });

    expect(h.fake.calls.filter((c) => c.method === "transactions.getTransactionById").map((c) => c.args[0])).toEqual([h.planId, "last-used"]);
  });
});
