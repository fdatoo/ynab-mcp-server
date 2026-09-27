import { describe, expect, it } from "vitest";
import { updateScheduledTransaction } from "../../../tools/scheduled/updateScheduledTransaction.js";
import { accountFixture, categoryFixture, categoryGroupFixture, payeeFixture, planFixture, scheduledTransactionFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

const FUTURE_DATE = "2099-06-01";
const LATER_FUTURE_DATE = "2099-07-01";

function seedRent() {
  const account = accountFixture({ name: "Checking" });
  const group = categoryGroupFixture({ name: "Bills" });
  const rent = categoryFixture({ category_group_id: group.id, name: "Rent" });
  const landlord = payeeFixture({ name: "Landlord" });
  const scheduled = scheduledTransactionFixture({
    account_id: account.id,
    date_first: FUTURE_DATE,
    date_next: FUTURE_DATE,
    frequency: "monthly",
    amount: -150000,
    memo: "Rent payment",
    payee_id: landlord.id,
    category_id: rent.id,
    flag_color: "red",
  });
  return {
    seed: planFixture({ accounts: [account], categoryGroups: [group], categories: [rent], payees: [landlord], scheduledTransactions: [scheduled] }),
    account,
    rent,
    landlord,
    scheduled,
  };
}

describe("ynab_update_scheduled_transaction", () => {
  it("changes only the given field and preserves the rest, despite the API's PUT being a full replace", async () => {
    const { seed, scheduled, account, rent, landlord } = seedRent();
    const h = setup(seed);

    const { data } = await h.call(updateScheduledTransaction, { scheduledTransactionId: scheduled.id, memo: "Rent payment (raised)" });

    expect(data.scheduled_transaction).toMatchObject({
      memo: "Rent payment (raised)",
      amount: -150,
      account: account.name,
      payee: landlord.name,
      category: rent.name,
      frequency: "monthly",
      flag_color: "red",
    });
  });

  it("sends every field in the PUT body, not just the one given", async () => {
    const { seed, scheduled } = seedRent();
    const h = setup(seed);

    await h.call(updateScheduledTransaction, { scheduledTransactionId: scheduled.id, memo: "Rent payment (raised)" });

    const call = h.fake.calls.find((c) => c.method === "scheduledTransactions.updateScheduledTransaction")!;
    const body = (call.args[2] as { scheduled_transaction: Record<string, unknown> }).scheduled_transaction;
    expect(body).toMatchObject({
      account_id: scheduled.account_id,
      date: FUTURE_DATE,
      amount: -150000,
      category_id: scheduled.category_id,
      flag_color: "red",
      frequency: "monthly",
      memo: "Rent payment (raised)",
    });
  });

  it("updates amount and direction together", async () => {
    const { seed, scheduled } = seedRent();
    const h = setup(seed);

    const { data } = await h.call(updateScheduledTransaction, { scheduledTransactionId: scheduled.id, amount: 200, direction: "outflow" });

    expect(data.scheduled_transaction.amount).toBe(-200);
  });

  it("rejects giving amount without direction", async () => {
    const { seed, scheduled } = seedRent();
    const h = setup(seed);

    const result = await h.call(updateScheduledTransaction, { scheduledTransactionId: scheduled.id, amount: 200 } as never);

    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("must be given together") });
  });

  it("moves the scheduled transaction to a different account", async () => {
    const { seed, scheduled } = seedRent();
    const savings = accountFixture({ name: "Savings" });
    const h = setup({ ...seed, accounts: [...(seed.accounts ?? []), savings] });

    const { data } = await h.call(updateScheduledTransaction, { scheduledTransactionId: scheduled.id, account: "Savings" });

    expect(data.scheduled_transaction.account).toBe("Savings");
  });

  it("changes the next date, still validating it is in the future", async () => {
    const { seed, scheduled } = seedRent();
    const h = setup(seed);

    const { data } = await h.call(updateScheduledTransaction, { scheduledTransactionId: scheduled.id, date: LATER_FUTURE_DATE });

    expect(data.scheduled_transaction.date_next).toBe(LATER_FUTURE_DATE);
  });

  it("rejects a new date that is today or earlier", async () => {
    const { seed, scheduled } = seedRent();
    const h = setup(seed);
    const today = new Date().toISOString().slice(0, 10);

    const result = await h.call(updateScheduledTransaction, { scheduledTransactionId: scheduled.id, date: today });

    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("must be in the future") });
  });

  it("switches to a transfer, using the target account's transfer payee", async () => {
    const { seed, scheduled } = seedRent();
    const savings = accountFixture({ name: "Savings" });
    const h = setup({ ...seed, accounts: [...(seed.accounts ?? []), savings] });

    const { data } = await h.call(updateScheduledTransaction, { scheduledTransactionId: scheduled.id, transferToAccount: "Savings" });

    expect(data.scheduled_transaction.payee).toBe("Transfer : Savings");
  });

  it("rejects giving both payee and transferToAccount", async () => {
    const { seed, scheduled } = seedRent();
    const savings = accountFixture({ name: "Savings" });
    const h = setup({ ...seed, accounts: [...(seed.accounts ?? []), savings] });

    const result = await h.call(updateScheduledTransaction, {
      scheduledTransactionId: scheduled.id,
      payee: "Someone",
      transferToAccount: "Savings",
    });

    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("not both") });
  });

  it("reports API failures as errors", async () => {
    const { seed, scheduled } = seedRent();
    const h = setup(seed);
    h.fake.failNext("scheduledTransactions.updateScheduledTransaction", ynabError("400", "bad_request", "Invalid scheduled transaction"));

    const result = await h.call(updateScheduledTransaction, { scheduledTransactionId: scheduled.id, memo: "New memo" });

    expect(result).toMatchObject({ isError: true, text: "Invalid scheduled transaction (YNAB error 400)" });
  });
});
