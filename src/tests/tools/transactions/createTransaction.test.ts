import { describe, expect, it } from "vitest";
import { createTransaction } from "../../../tools/transactions/createTransaction.js";
import {
  accountFixture,
  categoryFixture,
  categoryGroupFixture,
  payeeFixture,
  planFixture,
  ynabError,
} from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_create_transaction", () => {
  it("creates a transaction with a payee name, which really exists afterward", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(planFixture({ accounts: [account] }));

    const { data } = await h.call(createTransaction, {
      accountId: account.id,
      date: "2024-03-24",
      amount: -25.99,
      payeeName: "New Vendor",
    });

    expect(data).toMatchObject({ success: true, message: "Transaction created successfully" });
    const stored = await h.fake.api.transactions.getTransactionById(h.planId, data.transactionId);
    expect(stored.data.transaction.date).toBe("2024-03-24");
    expect(stored.data.transaction.amount).toBe(-25990);
    expect(stored.data.transaction.payee_name).toBe("New Vendor");
  });

  it("creates a transaction with an existing payeeId", async () => {
    const account = accountFixture({ name: "Checking" });
    const payee = payeeFixture({ name: "Cafe" });
    const h = setup(planFixture({ accounts: [account], payees: [payee] }));

    const { data } = await h.call(createTransaction, {
      accountId: account.id,
      date: "2024-01-01",
      amount: -10,
      payeeId: payee.id,
    });

    const stored = await h.fake.api.transactions.getTransactionById(h.planId, data.transactionId);
    expect(stored.data.transaction.payee_id).toBe(payee.id);
    expect(stored.data.transaction.payee_name).toBe("Cafe");
  });

  it("reuses an existing payee by name instead of creating a duplicate", async () => {
    const account = accountFixture({ name: "Checking" });
    const payee = payeeFixture({ name: "Cafe" });
    const h = setup(planFixture({ accounts: [account], payees: [payee] }));
    const before = await h.fake.api.payees.getPayees(h.planId);

    const { data } = await h.call(createTransaction, {
      accountId: account.id,
      date: "2024-01-01",
      amount: -10,
      payeeName: "Cafe",
    });

    const stored = await h.fake.api.transactions.getTransactionById(h.planId, data.transactionId);
    expect(stored.data.transaction.payee_id).toBe(payee.id);
    const after = await h.fake.api.payees.getPayees(h.planId);
    expect(after.data.payees).toHaveLength(before.data.payees.length);
  });

  it("requires either payeeId or payeeName", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(planFixture({ accounts: [account] }));

    const result = await h.call(createTransaction, { accountId: account.id, date: "2024-01-01", amount: -10 });

    expect(result).toMatchObject({ isError: true, text: "Either payeeId or payeeName must be provided" });
  });

  it("defaults cleared to uncleared and approved to false", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(planFixture({ accounts: [account] }));

    const { data } = await h.call(createTransaction, {
      accountId: account.id,
      date: "2024-01-01",
      amount: -10,
      payeeName: "Vendor",
    });

    const stored = await h.fake.api.transactions.getTransactionById(h.planId, data.transactionId);
    expect(stored.data.transaction.cleared).toBe("uncleared");
    expect(stored.data.transaction.approved).toBe(false);
  });

  it("sets cleared and approved when requested", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(planFixture({ accounts: [account] }));

    const { data } = await h.call(createTransaction, {
      accountId: account.id,
      date: "2024-01-01",
      amount: -10,
      payeeName: "Vendor",
      cleared: true,
      approved: true,
    });

    const stored = await h.fake.api.transactions.getTransactionById(h.planId, data.transactionId);
    expect(stored.data.transaction.cleared).toBe("cleared");
    expect(stored.data.transaction.approved).toBe(true);
  });

  it("assigns the category and memo", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday" });
    const category = categoryFixture({ category_group_id: group.id, name: "Groceries" });
    const h = setup(planFixture({ accounts: [account], categoryGroups: [group], categories: [category] }));

    const { data } = await h.call(createTransaction, {
      accountId: account.id,
      date: "2024-01-01",
      amount: -10,
      payeeName: "Vendor",
      categoryId: category.id,
      memo: "Note",
    });

    const stored = await h.fake.api.transactions.getTransactionById(h.planId, data.transactionId);
    expect(stored.data.transaction.category_id).toBe(category.id);
    expect(stored.data.transaction.memo).toBe("Note");
  });

  it("passes through a valid flag color", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(planFixture({ accounts: [account] }));

    const { data } = await h.call(createTransaction, {
      accountId: account.id,
      date: "2024-01-01",
      amount: -10,
      payeeName: "Vendor",
      flagColor: "blue",
    });

    const stored = await h.fake.api.transactions.getTransactionById(h.planId, data.transactionId);
    expect(stored.data.transaction.flag_color).toBe("blue");
  });

  it("reports API failures as errors", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(planFixture({ accounts: [account] }));
    h.fake.failNext("transactions.createTransaction", ynabError("404.2", "resource_not_found", "Resource not found"));

    const result = await h.call(createTransaction, {
      accountId: account.id,
      date: "2024-01-01",
      amount: -10,
      payeeName: "Vendor",
    });

    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });

  it("uses the default plan, or the one given", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(planFixture({ accounts: [account] }));

    await h.call(createTransaction, { accountId: account.id, date: "2024-01-01", amount: -10, payeeName: "Vendor" });
    await h.call(createTransaction, {
      accountId: account.id,
      date: "2024-01-02",
      amount: -10,
      payeeName: "Vendor",
      planId: "last-used",
    });

    expect(h.fake.calls.filter((c) => c.method === "transactions.createTransaction").map((c) => c.args[0])).toEqual([
      h.planId,
      "last-used",
    ]);
  });
});
