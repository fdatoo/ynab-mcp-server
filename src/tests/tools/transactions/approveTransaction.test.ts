import { describe, expect, it } from "vitest";
import { approveTransaction } from "../../../tools/transactions/approveTransaction.js";
import { accountFixture, planFixture, transactionFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_approve_transaction", () => {
  it("approves a transaction by default", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, approved: false })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(approveTransaction, { transactionId: seeded.id });

    expect(data).toEqual({ success: true, transactionId: seeded.id, message: "Transaction updated successfully" });
    const after = await h.fake.api.transactions.getTransactionById(h.planId, seeded.id);
    expect(after.data.transaction.approved).toBe(true);
  });

  it("unapproves when approved is explicitly false", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, approved: true })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    await h.call(approveTransaction, { transactionId: seeded.id, approved: false });

    const after = await h.fake.api.transactions.getTransactionById(h.planId, seeded.id);
    expect(after.data.transaction.approved).toBe(false);
  });

  it("reports a 404 for an unknown transaction", async () => {
    const h = setup();

    const result = await h.call(approveTransaction, { transactionId: "does-not-exist" });

    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });

  it("reports API failures from the update as errors", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, approved: false })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;
    h.fake.failNext("transactions.updateTransaction", ynabError("429", "too_many_requests", "Too many requests"));

    const result = await h.call(approveTransaction, { transactionId: seeded.id });

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
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, approved: false })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    await h.call(approveTransaction, { transactionId: seeded.id });
    await h.call(approveTransaction, { transactionId: seeded.id, planId: "last-used" });

    expect(h.fake.calls.filter((c) => c.method === "transactions.updateTransaction").map((c) => c.args[0])).toEqual([
      h.planId,
      "last-used",
    ]);
  });
});
