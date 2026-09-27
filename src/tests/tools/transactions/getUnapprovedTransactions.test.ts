import { describe, expect, it } from "vitest";
import { getUnapprovedTransactions } from "../../../tools/transactions/getUnapprovedTransactions.js";
import {
  accountFixture,
  categoryFixture,
  categoryGroupFixture,
  payeeFixture,
  planFixture,
  transactionFixture,
  ynabError,
} from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_get_unapproved_transactions", () => {
  it("returns only unapproved transactions with mapped fields", async () => {
    const account = accountFixture({ name: "Checking" });
    const payee = payeeFixture({ name: "Corner Grocer" });
    const group = categoryGroupFixture({ name: "Everyday" });
    const category = categoryFixture({ category_group_id: group.id, name: "Groceries" });
    const h = setup(
      planFixture({
        accounts: [account],
        payees: [payee],
        categoryGroups: [group],
        categories: [category],
        transactions: [
          transactionFixture({
            account_id: account.id,
            date: "2024-01-05",
            amount: -6000,
            payee_id: payee.id,
            category_id: category.id,
            approved: false,
            memo: "Needs review",
          }),
          transactionFixture({ account_id: account.id, date: "2024-01-06", amount: -2000, approved: true }),
        ],
      })
    );

    const { data } = await h.call(getUnapprovedTransactions, {});

    expect(data.transaction_count).toBe(1);
    const [txn] = data.transactions;
    expect(txn).toMatchObject({
      date: "2024-01-05",
      amount: "-6.00",
      memo: "Needs review",
      approved: false,
      account_name: "Checking",
      payee_name: "Corner Grocer",
      category_name: "Groceries",
    });
  });

  it("excludes deleted transactions", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, approved: false })],
      })
    );
    const [seeded] = (await h.fake.api.transactions.getTransactionsByAccount(h.planId, account.id)).data.transactions;
    await h.fake.api.transactions.deleteTransaction(h.planId, seeded.id);

    const { data } = await h.call(getUnapprovedTransactions, {});

    expect(data).toEqual({ transactions: [], transaction_count: 0 });
  });

  it("returns an empty list when there are no unapproved transactions", async () => {
    const h = setup(planFixture());

    const { data } = await h.call(getUnapprovedTransactions, {});

    expect(data).toEqual({ transactions: [], transaction_count: 0 });
  });

  it("converts milliunits to dollars, rounding to two decimals", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [
          transactionFixture({ account_id: account.id, date: "2024-01-05", amount: 123456, approved: false }),
        ],
      })
    );

    const { data } = await h.call(getUnapprovedTransactions, {});

    expect(data.transactions[0].amount).toBe("123.46");
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("transactions.getTransactions", ynabError("404.2", "resource_not_found", "Resource not found"));

    const result = await h.call(getUnapprovedTransactions, {});

    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });

  it("uses the default plan, or the one given", async () => {
    const h = setup();
    await h.call(getUnapprovedTransactions, {});
    await h.call(getUnapprovedTransactions, { planId: "last-used" });

    expect(h.fake.calls.filter((c) => c.method === "transactions.getTransactions").map((c) => c.args[0])).toEqual([
      h.planId,
      "last-used",
    ]);
  });
});
