import { describe, expect, it } from "vitest";
import { listAccounts } from "../../tools/accounts/listAccounts.js";
import { accountFixture, planFixture, ynabError } from "../fakes/ynab.js";
import { setup } from "./harness.js";

describe("ynab_list_accounts", () => {
  it("lists open, undeleted accounts", async () => {
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
    expect(data.accounts.map((a: { name: string }) => a.name)).toEqual(["Checking"]);
    expect(data.account_count).toBe(1);
  });

  it("includes closed accounts on request", async () => {
    const h = setup(
      planFixture({ accounts: [accountFixture({ name: "Checking" }), accountFixture({ name: "Old", closed: true })] })
    );
    const { data } = await h.call(listAccounts, { includeClosedAccounts: true });
    expect(data.accounts.map((a: { name: string }) => a.name)).toEqual(["Checking", "Old"]);
  });

  it("uses the default plan, or the one given", async () => {
    const h = setup();
    await h.call(listAccounts, {});
    await h.call(listAccounts, { planId: "last-used" });
    expect(h.fake.calls.map((c) => c.args[0])).toEqual([h.planId, "last-used"]);
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("accounts.getAccounts", ynabError("404.2", "resource_not_found", "Resource not found"));
    const result = await h.call(listAccounts, {});
    expect(result).toMatchObject({ isError: true, text: "Resource not found (YNAB error 404.2)" });
  });
});
