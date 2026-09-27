import { describe, expect, it } from "vitest";
import { importTransactions } from "../../../tools/transactions/importTransactions.js";
import { accountFixture, planFixture, transactionFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_import_transactions", () => {
  it("reports no new transactions when nothing is queued", async () => {
    const h = setup();

    const { data } = await h.call(importTransactions, {});

    expect(data).toEqual({ success: true, transaction_ids: [], imported_count: 0, message: "No new transactions to import" });
  });

  it("creates the queued transactions", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(planFixture({ accounts: [account] }));
    h.fake.queueImport(h.planId, [
      transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 }),
      transactionFixture({ account_id: account.id, date: "2024-01-06", amount: -2000 }),
    ]);

    const { data } = await h.call(importTransactions, {});

    expect(data.imported_count).toBe(2);
    expect(data.transaction_ids).toHaveLength(2);
    expect(data.message).toContain("Successfully imported 2 transaction(s)");
    for (const id of data.transaction_ids) {
      const stored = await h.fake.api.transactions.getTransactionById(h.planId, id);
      expect(stored.data.transaction.deleted).toBe(false);
    }
  });

  it("does not create a second transaction for a duplicate import_id", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(planFixture({ accounts: [account] }));
    h.fake.queueImport(h.planId, [
      transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, import_id: "bank-1" }),
      transactionFixture({ account_id: account.id, date: "2024-01-06", amount: -2000, import_id: "bank-1" }),
    ]);

    const { data } = await h.call(importTransactions, {});

    expect(data.imported_count).toBe(1);
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("transactions.importTransactions", ynabError("429", "too_many_requests", "Too many requests"));

    const result = await h.call(importTransactions, {});

    expect(result).toMatchObject({
      isError: true,
      text: "YNAB's rate limit is exhausted (200 requests per hour per token). Wait before retrying.",
    });
  });

  it("uses the default plan, or the one given", async () => {
    const h = setup();

    await h.call(importTransactions, {});
    await h.call(importTransactions, { planId: "last-used" });

    expect(h.fake.calls.map((c) => c.args[0])).toEqual([h.planId, "last-used"]);
  });
});
