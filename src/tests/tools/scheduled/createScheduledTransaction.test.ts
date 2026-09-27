import { describe, expect, it } from "vitest";
import { createScheduledTransaction } from "../../../tools/scheduled/createScheduledTransaction.js";
import { accountFixture, categoryFixture, categoryGroupFixture, payeeFixture, planFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

const FUTURE_DATE = "2099-06-01";

describe("ynab_create_scheduled_transaction", () => {
  it("creates a scheduled outflow with a category, resolved by name", async () => {
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Bills" });
    const rent = categoryFixture({ category_group_id: group.id, name: "Rent" });
    const landlord = payeeFixture({ name: "Landlord" });
    const h = setup(planFixture({ accounts: [account], categoryGroups: [group], categories: [rent], payees: [landlord] }));

    const { data } = await h.call(createScheduledTransaction, {
      account: "Checking",
      date: FUTURE_DATE,
      frequency: "monthly",
      amount: 1500,
      direction: "outflow",
      payee: "Landlord",
      category: "Rent",
    });

    expect(data.scheduled_transaction).toMatchObject({
      date_first: FUTURE_DATE,
      frequency: "monthly",
      amount: -1500,
      account: "Checking",
      payee: "Landlord",
      category: "Rent",
    });
  });

  it("creates a new payee when the name doesn't match one, and reports it", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(planFixture({ accounts: [account] }));

    const { data } = await h.call(createScheduledTransaction, {
      account: "Checking",
      date: FUTURE_DATE,
      frequency: "monthly",
      amount: 20,
      direction: "outflow",
      payee: "Brand New Gym",
    });

    expect(data.new_payees).toEqual(["Brand New Gym"]);
    expect(data.scheduled_transaction.payee).toBe("Brand New Gym");
  });

  it("rejects a date that is today or earlier", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(planFixture({ accounts: [account] }));

    const today = new Date().toISOString().slice(0, 10);
    const result = await h.call(createScheduledTransaction, {
      account: "Checking",
      date: today,
      frequency: "monthly",
      amount: 20,
      direction: "outflow",
      payee: "Someone",
    });

    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("must be in the future") });
  });

  it("rejects giving both payee and transferToAccount", async () => {
    const checking = accountFixture({ name: "Checking" });
    const savings = accountFixture({ name: "Savings" });
    const h = setup(planFixture({ accounts: [checking, savings] }));

    const result = await h.call(createScheduledTransaction, {
      account: "Checking",
      date: FUTURE_DATE,
      frequency: "monthly",
      amount: 20,
      direction: "outflow",
      payee: "Someone",
      transferToAccount: "Savings",
    });

    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("not both") });
  });

  it("creates a scheduled transfer using the target account's transfer payee", async () => {
    const checking = accountFixture({ name: "Checking" });
    const savings = accountFixture({ name: "Savings" });
    const h = setup(planFixture({ accounts: [checking, savings] }));

    const { data } = await h.call(createScheduledTransaction, {
      account: "Checking",
      date: FUTURE_DATE,
      frequency: "monthly",
      amount: 100,
      direction: "outflow",
      transferToAccount: "Savings",
    });

    expect(data.scheduled_transaction.payee).toBe("Transfer : Savings");
  });

  it("rejects transferring an account to itself", async () => {
    const checking = accountFixture({ name: "Checking" });
    const h = setup(planFixture({ accounts: [checking] }));

    const result = await h.call(createScheduledTransaction, {
      account: "Checking",
      date: FUTURE_DATE,
      frequency: "monthly",
      amount: 100,
      direction: "outflow",
      transferToAccount: "Checking",
    });

    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("cannot transfer an account to itself") });
  });

  it("reports API failures as errors", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(planFixture({ accounts: [account] }));
    h.fake.failNext("scheduledTransactions.createScheduledTransaction", ynabError("400", "bad_request", "Invalid scheduled transaction"));

    const result = await h.call(createScheduledTransaction, {
      account: "Checking",
      date: FUTURE_DATE,
      frequency: "monthly",
      amount: 20,
      direction: "outflow",
    });

    expect(result).toMatchObject({ isError: true, text: "Invalid scheduled transaction (YNAB error 400)" });
  });
});
