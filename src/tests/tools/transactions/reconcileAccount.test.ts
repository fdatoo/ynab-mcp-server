import { describe, expect, it } from "vitest";
import { reconcileAccount } from "../../../tools/transactions/reconcileAccount.js";
import {
  accountFixture,
  categoryFixture,
  categoryGroupFixture,
  planFixture,
  transactionFixture,
} from "../../fakes/ynab.js";
import { setup } from "../harness.js";

function build() {
  const checking = accountFixture({ name: "Checking" });
  const internal = categoryGroupFixture({ name: "Internal Master Category", internal: true });
  const rta = categoryFixture({ category_group_id: internal.id, name: "Inflow: Ready to Assign", internal: true });
  const h = setup(
    planFixture({
      accounts: [checking],
      categoryGroups: [internal],
      categories: [rta],
      transactions: [
        transactionFixture({ account_id: checking.id, date: "2024-01-01", amount: 100000, cleared: "reconciled" }),
        transactionFixture({ account_id: checking.id, date: "2024-01-10", amount: -20000, cleared: "cleared" }),
        transactionFixture({ account_id: checking.id, date: "2024-01-20", amount: -5000, cleared: "cleared" }),
        transactionFixture({ account_id: checking.id, date: "2024-01-25", amount: -7500, cleared: "uncleared" }),
        transactionFixture({ account_id: checking.id, date: "2024-02-05", amount: -1000, cleared: "cleared" }),
      ],
    })
  );
  const statuses = async () =>
    (await h.fake.api.transactions.getTransactionsByAccount(h.planId, checking.id)).data.transactions.map((t) => `${t.date}:${t.cleared}`);
  return { h, statuses };
}

describe("ynab_reconcile_account", () => {
  it("previews by default and changes nothing", async () => {
    const { h, statuses } = build();
    const before = await statuses();
    const { data } = await h.call(reconcileAccount, { account: "Checking", statementBalance: 74, statementDate: "2024-01-31" });
    expect(data).toMatchObject({ cleared_balance: 75, statement_balance: 74, difference: -1, balanced: false, applied: false });
    expect(await statuses()).toEqual(before);
    expect(h.fake.calls.some((c) => c.method.startsWith("transactions.update"))).toBe(false);
  });

  it("marks cleared transactions up to the statement date reconciled when balanced", async () => {
    const { h, statuses } = build();
    const { data } = await h.call(reconcileAccount, {
      account: "Checking",
      statementBalance: 75,
      statementDate: "2024-01-31",
      apply: true,
    });
    expect(data).toMatchObject({ balanced: true, applied: true, reconciled: 2 });
    expect(await statuses()).toEqual([
      "2024-01-01:reconciled",
      "2024-01-10:reconciled",
      "2024-01-20:reconciled",
      "2024-01-25:uncleared",
      "2024-02-05:cleared",
    ]);
  });

  it("points at an uncleared transaction that explains the difference", async () => {
    const { h } = build();
    const { data } = await h.call(reconcileAccount, { account: "Checking", statementBalance: 67.5, statementDate: "2024-01-31", apply: true });
    expect(data).toMatchObject({ balanced: false, applied: false, difference: -7.5 });
    expect(data.likely_explanation).toEqual([expect.objectContaining({ date: "2024-01-25", amount: -7.5 })]);
  });

  it("adds an adjustment only when asked, then reconciles", async () => {
    const { h, statuses } = build();
    const preview = await h.call(reconcileAccount, { account: "Checking", statementBalance: 74, statementDate: "2024-01-31", createAdjustment: true });
    expect(preview.data).toMatchObject({ applied: false, would_create_adjustment: -1 });

    const { data } = await h.call(reconcileAccount, {
      account: "Checking",
      statementBalance: 74,
      statementDate: "2024-01-31",
      createAdjustment: true,
      apply: true,
    });
    expect(data.adjustment).toMatchObject({ amount: -1, payee: "Reconciliation Balance Adjustment", category: "Inflow: Ready to Assign", cleared: "reconciled" });
    expect((await statuses()).filter((s) => s.startsWith("2024-01") && s.endsWith(":reconciled"))).toHaveLength(4);
  });

  it("uses every transaction when no statement date is given", async () => {
    const { h } = build();
    const { data } = await h.call(reconcileAccount, { account: "Checking", statementBalance: 74 });
    expect(data).toMatchObject({ cleared_balance: 74, balanced: true, transactions_to_reconcile: 3 });
  });
});
