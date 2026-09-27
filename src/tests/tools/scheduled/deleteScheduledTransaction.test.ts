import { describe, expect, it } from "vitest";
import { deleteScheduledTransaction } from "../../../tools/scheduled/deleteScheduledTransaction.js";
import { accountFixture, planFixture, scheduledTransactionFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_delete_scheduled_transaction", () => {
  it("deletes a scheduled transaction and returns what was deleted", async () => {
    const account = accountFixture({ name: "Checking" });
    const scheduled = scheduledTransactionFixture({ account_id: account.id, date_first: "2099-01-01", amount: -150000, memo: "Rent" });
    const h = setup(planFixture({ accounts: [account], scheduledTransactions: [scheduled] }));

    const { data } = await h.call(deleteScheduledTransaction, { scheduledTransactionId: scheduled.id });

    expect(data.deleted).toMatchObject({ id: scheduled.id, memo: "Rent", amount: -150 });
  });

  it("no longer lists the scheduled transaction afterwards", async () => {
    const account = accountFixture({ name: "Checking" });
    const scheduled = scheduledTransactionFixture({ account_id: account.id, date_first: "2099-01-01", amount: -150000 });
    const h = setup(planFixture({ accounts: [account], scheduledTransactions: [scheduled] }));

    await h.call(deleteScheduledTransaction, { scheduledTransactionId: scheduled.id });

    const remaining = (await h.ctx.api.scheduledTransactions.getScheduledTransactions(h.planId)).data.scheduled_transactions;
    expect(remaining.every((s) => s.deleted)).toBe(true);
  });

  it("reports API failures as errors", async () => {
    const account = accountFixture({ name: "Checking" });
    const scheduled = scheduledTransactionFixture({ account_id: account.id, date_first: "2099-01-01", amount: -150000 });
    const h = setup(planFixture({ accounts: [account], scheduledTransactions: [scheduled] }));
    h.fake.failNext("scheduledTransactions.deleteScheduledTransaction", ynabError("404.2", "resource_not_found", "Resource not found"));

    const result = await h.call(deleteScheduledTransaction, { scheduledTransactionId: scheduled.id });

    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });
});
