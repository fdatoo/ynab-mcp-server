import { describe, expect, it } from "vitest";
import { createAccount } from "../../../tools/accounts/createAccount.js";
import { ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_create_account", () => {
  it("creates an account with no starting balance", async () => {
    const h = setup();
    const { data } = await h.call(createAccount, { name: "Vacation Fund", type: "savings" });
    expect(data.account).toMatchObject({ name: "Vacation Fund", type: "savings", balance: 0 });
  });

  it("treats an outflow starting balance as a debt already owed", async () => {
    const h = setup();
    const { data } = await h.call(createAccount, {
      name: "Visa",
      type: "creditCard",
      startingBalance: 250,
      direction: "outflow",
    });
    expect(data.account.balance).toBe(-250);
  });

  it("treats an inflow starting balance as a positive balance", async () => {
    const h = setup();
    const { data } = await h.call(createAccount, { name: "Checking", type: "checking", startingBalance: 1000, direction: "inflow" });
    expect(data.account.balance).toBe(1000);
  });

  it("requires direction whenever startingBalance is given", async () => {
    const h = setup();
    const result = await h.call(createAccount, { name: "Checking", type: "checking", startingBalance: 100 } as never);
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("startingBalance and direction must be given together") });
  });

  it("makes the new account resolvable by name afterwards", async () => {
    const h = setup();
    await h.call(createAccount, { name: "New Checking", type: "checking" });
    const account = await h.ctx.lookup.resolveAccount(h.planId, "New Checking");
    expect(account.name).toBe("New Checking");
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("accounts.createAccount", ynabError("400", "bad_request", "Invalid account"));
    const result = await h.call(createAccount, { name: "Checking", type: "checking" });
    expect(result).toMatchObject({ isError: true, text: "Invalid account (YNAB error 400)" });
  });
});
