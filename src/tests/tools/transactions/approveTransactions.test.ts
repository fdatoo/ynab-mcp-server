import { describe, expect, it } from "vitest";
import { approveTransactions } from "../../../tools/transactions/approveTransactions.js";
import { accountFixture, planFixture, transactionFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_approve_transactions", () => {
  it("approves by id in a single updateTransactions call, without fetching first", async () => {
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

    const { data } = await h.call(approveTransactions, { ids: seeded.map((t) => t.id) });

    expect(data.updated_count).toBe(2);
    expect(data.transactions.every((t: { approved: boolean }) => t.approved)).toBe(true);
    const methods = h.fake.calls.map((c) => c.method);
    expect(methods.filter((m) => m === "transactions.updateTransactions")).toHaveLength(1);
    expect(methods.some((m) => m === "transactions.getTransactionById")).toBe(false);
  });

  it("unapproves by id when approved is false", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, approved: true })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(approveTransactions, { ids: [seeded.id], approved: false });

    expect(data.transactions[0].approved).toBe(false);
  });

  it("rejects approved: false without ids", async () => {
    const h = setup();
    const result = await h.call(approveTransactions, { account: "Checking", approved: false });
    expect(result).toMatchObject({ isError: true });
    expect(result.text).toMatch(/only valid together with ids/);
  });

  it("rejects giving both ids and a filter", async () => {
    const h = setup();
    const result = await h.call(approveTransactions, { ids: ["txn-1"], account: "Checking" });
    expect(result.text).toMatch(/either ids or a filter/);
  });

  it("rejects giving neither ids nor a filter", async () => {
    const h = setup();
    const result = await h.call(approveTransactions, {});
    expect(result.text).toMatch(/give ids, or a filter/);
  });

  it("approves every unapproved transaction matched by a filter, in one call", async () => {
    const h = setup();
    const before = (await h.call(approveTransactions, { dryRun: true, sinceDate: "2024-01-01", untilDate: "2024-02-28" })).data;
    expect(before.would_update_count).toBeGreaterThan(0);

    const { data } = await h.call(approveTransactions, { sinceDate: "2024-01-01", untilDate: "2024-02-28" });

    expect(data.updated_count).toBe(before.would_update_count);
    expect(h.fake.calls.filter((c) => c.method === "transactions.updateTransactions")).toHaveLength(1);
  });

  it("limits the filter to one account when given", async () => {
    const h = setup();
    const { data } = await h.call(approveTransactions, { account: "Checking" });
    expect(data.transactions.length).toBeGreaterThan(0);
    expect(h.fake.calls.some((c) => c.method === "transactions.getTransactionsByAccount")).toBe(true);
  });

  it("dry run with ids previews without writing", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, approved: false })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(approveTransactions, { ids: [seeded.id], dryRun: true });

    expect(data.dry_run).toBe(true);
    expect(data.would_update_count).toBe(1);
    expect(h.fake.calls.some((c) => c.method === "transactions.updateTransactions")).toBe(false);
    const after = await h.fake.api.transactions.getTransactionById(h.planId, seeded.id);
    expect(after.data.transaction.approved).toBe(false);
  });

  it("reports ids missing from the response as not_updated", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, approved: false })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(approveTransactions, { ids: [seeded.id, "does-not-exist"] });

    expect(data.updated_count).toBe(1);
    expect(data.not_updated).toEqual(["does-not-exist"]);
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("transactions.updateTransactions", ynabError("429", "too_many_requests", "Too many requests"));

    const result = await h.call(approveTransactions, { ids: ["txn-1"] });

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

    await h.call(approveTransactions, { ids: [seeded.id] });
    await h.call(approveTransactions, { ids: [seeded.id], planId: "last-used" });

    expect(h.fake.calls.filter((c) => c.method === "transactions.updateTransactions").map((c) => c.args[0])).toEqual([h.planId, "last-used"]);
  });

  it("previews a list of ids with a single request, flagging ids it cannot approve", async () => {
    const h = setup();
    const unapproved = (await h.fake.api.transactions.getTransactions(h.planId, undefined, undefined, "unapproved")).data.transactions;
    const approvedAlready = (await h.fake.api.transactions.getTransactions(h.planId)).data.transactions.find((t) => t.approved)!;
    h.fake.calls.length = 0;
    const { data } = await h.call(approveTransactions, { ids: [unapproved[0].id, approvedAlready.id, "missing"], dryRun: true });
    expect(data.would_update_count).toBe(1);
    expect(data.not_found).toEqual([approvedAlready.id, "missing"]);
    expect(h.fake.calls.map((c) => c.method)).toEqual(["plans.getPlanSettingsById", "transactions.getTransactions"]);
  });
});
