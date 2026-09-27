import { describe, expect, it } from "vitest";
import { updateTransaction } from "../../../tools/transactions/updateTransaction.js";
import {
  accountFixture,
  categoryFixture,
  categoryGroupFixture,
  payeeFixture,
  planFixture,
  transactionFixture,
} from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_update_transaction", () => {
  it("updates only the provided fields, leaving others unchanged", async () => {
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

    const { data } = await h.call(updateTransaction, { transactionId: seeded.id, memo: "New memo" });

    expect(data.transaction.memo).toBe("New memo");
    const after = await h.fake.api.transactions.getTransactionById(h.planId, seeded.id);
    expect(after.data.transaction.amount).toBe(-5000);
    expect(after.data.transaction.category_id).toBe(category.id);
    expect(after.data.transaction.payee_id).toBe(payee.id);
    expect(after.data.transaction.cleared).toBe("cleared");
    expect(after.data.transaction.approved).toBe(true);
  });

  it("converts the amount to milliunits", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    await h.call(updateTransaction, { transactionId: seeded.id, amount: -100.5 });

    const after = await h.fake.api.transactions.getTransactionById(h.planId, seeded.id);
    expect(after.data.transaction.amount).toBe(-100500);
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

    const { data } = await h.call(updateTransaction, { transactionId: seeded.id, accountId: savings.id });

    expect(data.transaction.account_name).toBe("Savings");
    const after = await h.fake.api.transactions.getTransactionById(h.planId, seeded.id);
    expect(after.data.transaction.account_id).toBe(savings.id);
  });

  it("updates the payee by id", async () => {
    const account = accountFixture({ name: "Checking" });
    const oldPayee = payeeFixture({ name: "Old Payee" });
    const newPayee = payeeFixture({ name: "New Payee" });
    const h = setup(
      planFixture({
        accounts: [account],
        payees: [oldPayee, newPayee],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, payee_id: oldPayee.id })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(updateTransaction, { transactionId: seeded.id, payeeId: newPayee.id });

    expect(data.transaction.payee_name).toBe("New Payee");
  });

  it.each([
    ["cleared", "cleared"],
    ["uncleared", "uncleared"],
    ["reconciled", "reconciled"],
  ] as const)("updates the cleared status to %s", async (input, expected) => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, cleared: "uncleared" })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(updateTransaction, { transactionId: seeded.id, cleared: input });

    expect(data.transaction.cleared).toBe(expected);
  });

  it("updates the flag color", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    const { data } = await h.call(updateTransaction, { transactionId: seeded.id, flagColor: "blue" });

    expect(data.transaction.flag_color).toBe("blue");
  });

  it("reports a 404 for an unknown transaction", async () => {
    const h = setup();

    const result = await h.call(updateTransaction, { transactionId: "does-not-exist", memo: "x" });

    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });

  it("uses the default plan, or the one given", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000 })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;

    await h.call(updateTransaction, { transactionId: seeded.id, memo: "a" });
    await h.call(updateTransaction, { transactionId: seeded.id, planId: "last-used", memo: "b" });

    expect(h.fake.calls.filter((c) => c.method === "transactions.updateTransaction").map((c) => c.args[0])).toEqual([
      h.planId,
      "last-used",
    ]);
  });
  it("sets the payee by name, creating it when new", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -5000 })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;
    const { data } = await h.call(updateTransaction, { transactionId: seeded.id, payeeName: "New Bakery" });
    expect(data.transaction.payee_name).toBe("New Bakery");
    const payees = (await h.fake.api.payees.getPayees(h.planId)).data.payees.map((p) => p.name);
    expect(payees).toContain("New Bakery");
  });
});
