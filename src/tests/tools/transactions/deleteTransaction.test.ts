import { describe, expect, it } from "vitest";
import { deleteTransaction } from "../../../tools/transactions/deleteTransaction.js";
import { accountFixture, planFixture, transactionFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_delete_transaction", () => {
  it("deletes a transaction", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(deleteTransaction, { transactionId: seeded.id });

    expect(data).toEqual({ success: true, transactionId: seeded.id, message: "Transaction deleted successfully" });
    const after = await h.fake.api.transactions.getTransactionById(h.planId, seeded.id);
    expect(after.data.transaction.deleted).toBe(true);
  });

  it("deletes both sides of a transfer", async () => {
    const checking = accountFixture({ name: "Checking" });
    const creditCard = accountFixture({ name: "Credit Card", type: "creditCard" });
    const h = setup(
      planFixture({
        accounts: [checking, creditCard],
        transactions: [
          transactionFixture({ account_id: checking.id, date: "2024-01-05", amount: -5000, transfer_to_account_id: creditCard.id }),
        ],
      })
    );
    const [original] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, checking.id)).data.transactions;

    await h.call(deleteTransaction, { transactionId: original.id });

    const mirror = await h.fake.api.transactions.getTransactionById(h.planId, original.transfer_transaction_id!);
    expect(mirror.data.transaction.deleted).toBe(true);
    const originalAfter = await h.fake.api.transactions.getTransactionById(h.planId, original.id);
    expect(originalAfter.data.transaction.deleted).toBe(true);
  });

  it("reports a 404 for an unknown transaction", async () => {
    const h = setup();

    const result = await h.call(deleteTransaction, { transactionId: "does-not-exist" });

    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });

  it("reports other API failures as errors", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;
    h.fake.failNext("transactions.deleteTransaction", ynabError("429", "too_many_requests", "Too many requests"));

    const result = await h.call(deleteTransaction, { transactionId: seeded.id });

    expect(result).toMatchObject({
      isError: true,
      text: "YNAB's rate limit is exhausted (200 requests per hour per token). Wait before retrying.",
    });
  });

  it("uses the default plan, or the one given", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [
          transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 }),
          transactionFixture({ account_id: account.id, date: "2024-01-06", amount: -1000 }),
        ],
      })
    );
    const [first, second] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    await h.call(deleteTransaction, { transactionId: first.id });
    await h.call(deleteTransaction, { transactionId: second.id, planId: "last-used" });

    expect(h.fake.calls.filter((c) => c.method === "transactions.deleteTransaction").map((c) => c.args[0])).toEqual([
      h.planId,
      "last-used",
    ]);
  });
});
