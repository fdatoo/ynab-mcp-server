import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchTransactions } from "../../../tools/transactions/searchTransactions.js";
import { accountFixture, planFixture, transactionFixture } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

type Row = { id: string; date: string; amount: number; payee: string | null; category: string | null; memo: string | null };

describe("ynab_search_transactions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-02-20T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the newest transactions first, so a limit keeps the most recent", async () => {
    const h = setup();
    const { data } = await h.call(searchTransactions, { limit: 3 });
    expect(data.transactions.map((t: Row) => t.date)).toEqual(["2024-02-10", "2024-02-05", "2024-02-02"]);
    expect(data.total_matching).toBeGreaterThan(3);
    expect(data.next_offset).toBe(3);
  });

  it("pages with offset, and sorts oldest first on request", async () => {
    const h = setup();
    const all = (await h.call(searchTransactions, { limit: 500 })).data.transactions.map((t: Row) => t.id);
    const second = (await h.call(searchTransactions, { limit: 2, offset: 2 })).data.transactions.map((t: Row) => t.id);
    expect(second).toEqual(all.slice(2, 4));
    const oldest = (await h.call(searchTransactions, { sort: "oldest", limit: 1 })).data.transactions[0];
    expect(oldest.date).toBe("2024-01-03");
  });

  it("searches the last 90 days by default and says so", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [
          transactionFixture({ account_id: account.id, date: "2023-10-01", amount: -1000, payee_name: "Too Old" }),
          transactionFixture({ account_id: account.id, date: "2024-01-01", amount: -1000, payee_name: "Recent" }),
        ],
      })
    );
    const { data } = await h.call(searchTransactions, {});
    expect(data.searched).toEqual({ since: "2023-11-22", until: null });
    expect(data.transactions.map((t: Row) => t.payee)).toEqual(["Recent"]);
    const [call] = h.fake.calls.filter((c) => c.method === "transactions.getTransactions");
    expect(call.args[1]).toBe("2023-11-22");
  });

  it("passes sinceDate and untilDate to the API", async () => {
    const h = setup();
    const { data } = await h.call(searchTransactions, { sinceDate: "2024-01-05", untilDate: "2024-01-12" });
    expect(data.transactions.map((t: Row) => t.date)).toEqual(["2024-01-12", "2024-01-10", "2024-01-05"]);
    const [call] = h.fake.calls.filter((c) => c.method === "transactions.getTransactions");
    expect(call.args.slice(1, 3)).toEqual(["2024-01-05", "2024-01-12"]);
  });

  it("reports signed amounts in currency units: outflows negative", async () => {
    const h = setup();
    const { data } = await h.call(searchTransactions, { text: "employer", sort: "oldest" });
    expect(data.currency).toBe("USD");
    expect(data.transactions.map((t: Row) => t.amount)).toEqual([200, 10]);
    const grocer = await h.call(searchTransactions, { payee: "Corner Grocer", sort: "oldest", limit: 1 });
    expect(grocer.data.transactions[0].amount).toBe(-6);
  });

  it("filters by account, category and payee given by name", async () => {
    const h = setup();
    const byAccount = await h.call(searchTransactions, { account: "Credit Card" });
    expect(byAccount.data.transactions.every((t: { account: string }) => t.account === "Credit Card")).toBe(true);
    expect(h.fake.calls.at(-1)?.method).toBe("transactions.getTransactionsByAccount");

    const combined = await h.call(searchTransactions, { account: "Checking", payee: "Downtown Cafe" });
    expect(combined.data.transactions.map((t: Row) => t.date)).toEqual(["2024-02-02", "2024-01-10"]);
  });

  it("includes matching split lines when filtering by category", async () => {
    const h = setup();
    const { data } = await h.call(searchTransactions, { category: "Dining Out", sort: "oldest" });
    const splitLine = data.transactions.find((t: { split_line?: boolean }) => t.split_line);
    expect(splitLine).toMatchObject({ date: "2024-01-20", amount: -4, category: "Dining Out" });
  });

  it("shows split lines on a split transaction", async () => {
    const h = setup();
    const { data } = await h.call(searchTransactions, { sinceDate: "2024-01-20", untilDate: "2024-01-20" });
    expect(data.transactions[0]).toMatchObject({
      category: "Split",
      amount: -12,
      subtransactions: [
        { amount: -8, category: "Groceries" },
        { amount: -4, category: "Dining Out" },
      ],
    });
  });

  it("filters by status, text, amount range, direction and cleared status", async () => {
    const h = setup();
    const unapproved = await h.call(searchTransactions, { status: "unapproved" });
    expect(unapproved.data.transactions.every((t: { approved: boolean }) => !t.approved)).toBe(true);

    const text = await h.call(searchTransactions, { text: "KIOSK" });
    expect(text.data.transactions.map((t: Row) => t.payee)).toEqual(["Unknown Kiosk"]);

    const range = await h.call(searchTransactions, { minAmount: 5, maxAmount: 9, direction: "outflow" });
    expect(range.data.transactions.map((t: Row) => t.amount)).toEqual([-9, -5.5, -6]);

    const inflows = await h.call(searchTransactions, { direction: "inflow" });
    expect(inflows.data.transactions.every((t: Row) => t.amount > 0)).toBe(true);
  });

  it("totals all matches, not just the page", async () => {
    const h = setup();
    const { data } = await h.call(searchTransactions, { payee: "Downtown Cafe", limit: 1 });
    expect(data.net_amount).toBe(-15.5);
  });

  it("explains names it cannot resolve", async () => {
    const h = setup();
    const result = await h.call(searchTransactions, { category: "Groc" });
    expect(result).toMatchObject({ isError: true });
    expect(result.text).toMatch(/No category matches "Groc". Did you mean: Everyday Expenses: Groceries\?/);
  });

  it("rejects malformed dates before calling the API", async () => {
    const h = setup();
    await expect(h.call(searchTransactions, { sinceDate: "Jan 5" })).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("leaves transfers out of uncategorized results, though the API includes them", async () => {
    const h = setup();
    const { data } = await h.call(searchTransactions, { status: "uncategorized", sinceDate: "2024-01-01" });
    expect(data.transactions.some((t: { transfer_account_id?: string }) => t.transfer_account_id)).toBe(false);
    expect(data.transactions.map((t: Row) => t.payee).sort()).toEqual(["Employer", "Employer", "Unknown Kiosk"]);
  });

  it("finds text in a split line's memo", async () => {
    const account = accountFixture({ name: "Checking" });
    const h = setup(
      planFixture({
        accounts: [account],
        transactions: [
          transactionFixture({
            account_id: account.id,
            date: "2024-02-10",
            amount: -3000,
            payee_name: "Big Box",
            subtransactions: [
              { amount: -1000, memo: "birthday candles" },
              { amount: -2000, memo: "paper towels" },
            ],
          }),
        ],
      })
    );
    const { data } = await h.call(searchTransactions, { text: "candles" });
    expect(data.transactions.map((t: Row) => t.payee)).toEqual(["Big Box"]);
  });
});
