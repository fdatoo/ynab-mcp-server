import { describe, expect, it } from "vitest";
import { bulkApproveTransactions } from "../../../tools/transactions/bulkApproveTransactions.js";
import { accountFixture, planFixture, transactionFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_bulk_approve_transactions", () => {
  it("approves multiple transactions", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [
          transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, approved: false }),
          transactionFixture({ account_id: account.id, date: "2024-01-06", amount: -2000, approved: false }),
        ],
      })
    );
    const seeded = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(bulkApproveTransactions, { transactionIds: seeded.map((t) => t.id) });

    expect(data.success).toBe(true);
    expect(data.approved_count).toBe(2);
    expect(data.transactions.map((t: { amount: string }) => t.amount)).toEqual(["-1.00", "-2.00"]);
    for (const t of seeded) {
      const after = await h.fake.api.transactions.getTransactionById(h.planId, t.id);
      expect(after.data.transaction.approved).toBe(true);
    }
  });

  it("approves a single transaction", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, approved: false })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(bulkApproveTransactions, { transactionIds: [seeded.id] });

    expect(data.approved_count).toBe(1);
  });

  it("rejects an empty list of transaction ids", async () => {
    const h = setup();

    const result = await h.call(bulkApproveTransactions, { transactionIds: [] });

    expect(result).toMatchObject({ isError: true, text: "No transaction IDs provided" });
  });

  // The fake silently skips ids it doesn't recognize (see report: this looks
  // like a gap worth reviewing, not something to pin as correct).
  it("skips ids that don't exist, approving only the ones that do", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, approved: false })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(bulkApproveTransactions, { transactionIds: [seeded.id, "does-not-exist"] });

    expect(data.approved_count).toBe(1);
    expect(data.transactions).toHaveLength(1);
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("transactions.updateTransactions", ynabError("429", "too_many_requests", "Too many requests"));

    const result = await h.call(bulkApproveTransactions, { transactionIds: ["txn-1"] });

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

    await h.call(bulkApproveTransactions, { transactionIds: [seeded.id] });
    await h.call(bulkApproveTransactions, { transactionIds: [seeded.id], planId: "last-used" });

    expect(h.fake.calls.filter((c) => c.method === "transactions.updateTransactions").map((c) => c.args[0])).toEqual([
      h.planId,
      "last-used",
    ]);
  });
});
