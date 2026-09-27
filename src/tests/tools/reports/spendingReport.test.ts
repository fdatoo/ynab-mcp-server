import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spendingReport } from "../../../tools/reports/spendingReport.js";
import { setup } from "../harness.js";

type Row = { name: string; total: number; lines: number; percent: number };
const byName = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.name, r.total]));

describe("ynab_spending_report", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-02-20T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("totals spending by category as positive amounts, splitting split lines", async () => {
    const h = setup();
    const { data } = await h.call(spendingReport, { sinceDate: "2024-01-01", untilDate: "2024-01-31" });
    // Groceries: 6 + split 8. Dining: 4.5 + split 4. The kiosk is uncategorized; the transfer is excluded.
    expect(byName(data.rows)).toEqual({ Groceries: 14, "Dining Out": 8.5, "(uncategorized)": 3 });
    expect(data.total).toBe(25.5);
    expect(data.rows[0]).toMatchObject({ name: "Groceries", percent: 54.9 });
  });

  it("includes transfers on request", async () => {
    const h = setup();
    const { data } = await h.call(spendingReport, { sinceDate: "2024-01-01", untilDate: "2024-01-31", includeTransfers: true });
    expect(byName(data.rows)["(transfer)"]).toBe(50);
  });

  it("groups by category group and by payee", async () => {
    const h = setup();
    const groups = await h.call(spendingReport, { sinceDate: "2024-01-01", untilDate: "2024-01-31", groupBy: "group" });
    expect(byName(groups.data.rows)).toMatchObject({ "Everyday Expenses": 22.5 });
    const payees = await h.call(spendingReport, { sinceDate: "2024-01-01", untilDate: "2024-01-31", groupBy: "payee" });
    expect(byName(payees.data.rows)).toMatchObject({ "Corner Grocer": 18, "Downtown Cafe": 4.5, "Unknown Kiosk": 3 });
  });

  it("reports income and net", async () => {
    const h = setup();
    const income = await h.call(spendingReport, { sinceDate: "2024-01-01", measure: "inflows", groupBy: "payee" });
    expect(byName(income.data.rows)).toEqual({ Employer: 210 });
    const net = await h.call(spendingReport, { sinceDate: "2024-02-01", measure: "net", groupBy: "payee" });
    expect(net.data.total).toBe(-5.5 - 2 - 9 + 10);
  });

  it("defaults to the current month and can narrow to an account", async () => {
    const h = setup();
    const { data } = await h.call(spendingReport, { account: "Credit Card" });
    expect(data.period.since).toBe("2024-02-01");
    expect(data).toMatchObject({ account: "Credit Card", total: 9 });
  });

  it("folds rows past top into Other", async () => {
    const h = setup();
    const { data } = await h.call(spendingReport, { sinceDate: "2024-01-01", untilDate: "2024-01-31", top: 1 });
    expect(data.rows.map((r: Row) => r.name)).toEqual(["Groceries", "Other (2)"]);
    expect(data.rows[1].total).toBe(11.5);
  });
});
