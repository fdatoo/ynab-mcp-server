import { describe, expect, it } from "vitest";
import { renamePayee } from "../../../tools/payees/renamePayee.js";
import { accountFixture, payeeFixture, planFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_rename_payee", () => {
  it("renames a payee found by id", async () => {
    const grocer = payeeFixture({ name: "Corner Grocer" });
    const h = setup(planFixture({ payees: [grocer] }));
    const { data } = await h.call(renamePayee, { payee: grocer.id, name: "Corner Grocery" });
    expect(data.payee).toEqual({ id: grocer.id, name: "Corner Grocery" });
  });

  it("renames a payee found by name", async () => {
    const grocer = payeeFixture({ name: "Corner Grocer" });
    const h = setup(planFixture({ payees: [grocer] }));
    const { data } = await h.call(renamePayee, { payee: "Corner Grocer", name: "Corner Grocery" });
    expect(data.payee.name).toBe("Corner Grocery");
  });

  it("refuses to rename a transfer payee", async () => {
    const account = accountFixture({ name: "Savings" });
    const h = setup(planFixture({ accounts: [account] }));
    const result = await h.call(renamePayee, { payee: "Transfer : Savings", name: "Something else" });
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("cannot be renamed") });
  });

  it("does not call the API when refusing a transfer payee rename", async () => {
    const account = accountFixture({ name: "Savings" });
    const h = setup(planFixture({ accounts: [account] }));
    await h.call(renamePayee, { payee: "Transfer : Savings", name: "Something else" });
    expect(h.fake.calls.some((c) => c.method === "payees.updatePayee")).toBe(false);
  });

  it("reports API failures as errors", async () => {
    const grocer = payeeFixture({ name: "Corner Grocer" });
    const h = setup(planFixture({ payees: [grocer] }));
    h.fake.failNext("payees.updatePayee", ynabError("400", "bad_request", "Invalid payee"));
    const result = await h.call(renamePayee, { payee: grocer.id, name: "Corner Grocery" });
    expect(result).toMatchObject({ isError: true, text: "Invalid payee (YNAB error 400)" });
  });

  it("reports an unknown payee reference clearly", async () => {
    const h = setup();
    const result = await h.call(renamePayee, { payee: "Nobody", name: "Somebody" });
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("No payee matches") });
  });
});
