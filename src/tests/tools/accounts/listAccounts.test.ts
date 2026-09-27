import { describe, expect, it } from "vitest";
import { listAccounts } from "../../../tools/accounts/listAccounts.js";
import { accountFixture, planFixture, transactionFixture, ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_list_accounts", () => {
  it("lists open, undeleted accounts with balances in the plan currency", async () => {
    const h = setup(
      planFixture({
        accounts: [
          accountFixture({ name: "Checking" }),
          accountFixture({ name: "Old Savings", closed: true }),
          accountFixture({ name: "Gone", deleted: true }),
        ],
      })
    );
    const { data } = await h.call(listAccounts, {});
    expect(data.currency).toBe("USD");
    expect(data.accounts.map((a: { name: string }) => a.name)).toEqual(["Checking"]);
    expect(data.account_count).toBe(1);
  });

  it("converts balances from milliunits to plain numbers", async () => {
    const checking = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [checking],
        transactions: [
          transactionFixture({ account_id: checking.id, date: "2024-01-01", amount: 100000, cleared: "cleared" }),
          transactionFixture({ account_id: checking.id, date: "2024-01-02", amount: 23450, cleared: "uncleared" }),
        ],
      })
    );
    const { data } = await h.call(listAccounts, {});
    expect(data.accounts[0]).toMatchObject({ balance: 123.45, cleared_balance: 100, uncleared_balance: 23.45 });
  });

  it("includes closed accounts on request", async () => {
    const h = setup(
      planFixture({ accounts: [accountFixture({ name: "Checking" }), accountFixture({ name: "Old", closed: true })] })
    );
    const { data } = await h.call(listAccounts, { includeClosedAccounts: true });
    expect(data.accounts.map((a: { name: string }) => a.name)).toEqual(["Checking", "Old"]);
  });

  it("reports note, last_reconciled_at and direct import flags", async () => {
    const h = setup(
      planFixture({
        accounts: [
          accountFixture({
            name: "Checking",
            note: "Joint account",
            last_reconciled_at: "2024-05-01T00:00:00Z",
            direct_import_linked: true,
            direct_import_in_error: true,
          }),
        ],
      })
    );
    const { data } = await h.call(listAccounts, {});
    expect(data.accounts[0]).toMatchObject({
      note: "Joint account",
      last_reconciled_at: "2024-05-01T00:00:00Z",
      direct_import_linked: true,
      direct_import_in_error: true,
    });
  });

  it("defaults note and direct import flags for a plain unlinked account", async () => {
    const h = setup(planFixture({ accounts: [accountFixture({ name: "Checking" })] }));
    const { data } = await h.call(listAccounts, {});
    expect(data.accounts[0]).toMatchObject({ note: null, last_reconciled_at: null, direct_import_linked: false, direct_import_in_error: false });
  });

  it("uses the default plan, or the one given", async () => {
    const h = setup();
    await h.call(listAccounts, {});
    await h.call(listAccounts, { planId: "last-used" });
    expect(h.fake.calls.filter((c) => c.method === "accounts.getAccounts").map((c) => c.args[0])).toEqual([h.planId, "last-used"]);
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("accounts.getAccounts", ynabError("404.2", "resource_not_found", "Resource not found"));
    const result = await h.call(listAccounts, {});
    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });
});
