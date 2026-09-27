import { describe, expect, it } from "vitest";
import { listPayees } from "../../../tools/payees/listPayees.js";
import { accountFixture, payeeFixture, planFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_list_payees", () => {
  it("lists non-deleted payees", async () => {
    const grocer = payeeFixture({ name: "Corner Grocer" });
    const gone = payeeFixture({ name: "Old Store", deleted: true });
    const h = setup(planFixture({ payees: [grocer, gone] }));

    const { data } = await h.call(listPayees, {});

    const names = data.payees.map((p: { name: string }) => p.name);
    expect(names).toEqual(["Corner Grocer"]);
    expect(data.payee_count).toBe(1);
  });

  it("includes the transfer payee YNAB creates for each account, with its transfer_account_id", async () => {
    const account = accountFixture({ name: "Savings" });
    const h = setup(planFixture({ accounts: [account] }));

    const { data } = await h.call(listPayees, {});

    expect(data.payees).toEqual([{ id: expect.any(String), name: "Transfer : Savings", transfer_account_id: account.id }]);
  });

  it("reports null transfer_account_id for a regular payee", async () => {
    const grocer = payeeFixture({ name: "Corner Grocer" });
    const h = setup(planFixture({ payees: [grocer] }));

    const { data } = await h.call(listPayees, {});

    expect(data.payees[0].transfer_account_id).toBeNull();
  });

  it("handles a plan with no payees", async () => {
    const h = setup(planFixture());
    const { data } = await h.call(listPayees, {});
    expect(data).toEqual({ payees: [], payee_count: 0 });
  });

  it("uses the default plan, or the one given", async () => {
    const h = setup();
    await h.call(listPayees, {});
    await h.call(listPayees, { planId: "last-used" });
    expect(h.fake.calls.map((c) => c.args[0])).toEqual([h.planId, "last-used"]);
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("payees.getPayees", ynabError("404.2", "resource_not_found", "Resource not found"));
    const result = await h.call(listPayees, {});
    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });
  it("lists regular and transfer payees together", async () => {
    const h = setup(planFixture({ accounts: [accountFixture({ name: "Savings" })], payees: [payeeFixture({ name: "Corner Grocer" })] }));
    const { data } = await h.call(listPayees, {});
    expect(data.payees.map((p: { name: string }) => p.name).sort()).toEqual(["Corner Grocer", "Transfer : Savings"]);
  });
});
