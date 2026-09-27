import { describe, expect, it } from "vitest";
import { createTransactions } from "../../../tools/transactions/createTransactions.js";
import { searchTransactions } from "../../../tools/transactions/searchTransactions.js";
import { setup } from "../harness.js";

const base = { account: "Checking", date: "2024-02-15" };

async function balance(h: ReturnType<typeof setup>, name: string) {
  const { data } = await h.fake.api.accounts.getAccounts(h.planId);
  return data.accounts.find((a) => a.name === name)!.balance;
}

describe("ynab_create_transactions", () => {
  it("records an outflow as money leaving the account", async () => {
    const h = setup();
    const before = await balance(h, "Checking");
    const { data } = await h.call(createTransactions, {
      transactions: [{ ...base, amount: 12.5, direction: "outflow", payee: "Corner Grocer", category: "Groceries" }],
    });
    expect(data.created[0]).toMatchObject({ amount: -12.5, payee: "Corner Grocer", category: "Groceries", account: "Checking" });
    expect(await balance(h, "Checking")).toBe(before - 12500);
  });

  it("records an inflow as money arriving", async () => {
    const h = setup();
    const { data } = await h.call(createTransactions, {
      transactions: [{ ...base, amount: 40, direction: "inflow", payee: "Employer" }],
    });
    expect(data.created[0].amount).toBe(40);
  });

  it("requires a positive amount and a direction", async () => {
    const h = setup();
    await expect(h.call(createTransactions, { transactions: [{ ...base, amount: -5, direction: "outflow" }] })).rejects.toThrow();
    await expect(h.call(createTransactions, { transactions: [{ ...base, amount: 5 } as never] })).rejects.toThrow();
  });

  it("creates a payee for an unknown name and says so", async () => {
    const h = setup();
    const { data } = await h.call(createTransactions, {
      transactions: [{ ...base, amount: 3, direction: "outflow", payee: "Brand New Bakery" }],
    });
    expect(data.new_payees).toEqual(["Brand New Bakery"]);
    expect(data.created[0].payee).toBe("Brand New Bakery");
  });

  it("creates a transfer that YNAB mirrors in the other account", async () => {
    const h = setup();
    const cardBefore = await balance(h, "Credit Card");
    const { data } = await h.call(createTransactions, {
      transactions: [{ ...base, amount: 100, direction: "outflow", transferToAccount: "Credit Card" }],
    });
    expect(data.created[0].transfer_account_id).toBeDefined();
    expect(await balance(h, "Credit Card")).toBe(cardBefore + 100000);
  });

  it("creates a split whose lines add up", async () => {
    const h = setup();
    const { data } = await h.call(createTransactions, {
      transactions: [
        {
          ...base,
          amount: 30,
          direction: "outflow",
          payee: "Corner Grocer",
          splits: [
            { amount: 20, category: "Groceries" },
            { amount: 10, category: "Dining Out", memo: "snacks" },
          ],
        },
      ],
    });
    expect(data.created[0]).toMatchObject({
      category: "Split",
      amount: -30,
      subtransactions: [
        { amount: -20, category: "Groceries" },
        { amount: -10, category: "Dining Out", memo: "snacks" },
      ],
    });
  });

  it("lets a split line go the other way, such as a refund inside a purchase", async () => {
    const h = setup();
    const { data } = await h.call(createTransactions, {
      transactions: [
        {
          ...base,
          amount: 15,
          direction: "outflow",
          splits: [
            { amount: 20, category: "Groceries" },
            { amount: 5, direction: "inflow", category: "Dining Out" },
          ],
        },
      ],
    });
    expect(data.created[0].subtransactions.map((s: { amount: number }) => s.amount)).toEqual([-20, 5]);
  });

  it("rejects splits that do not add up, before calling the API", async () => {
    const h = setup();
    const result = await h.call(createTransactions, {
      transactions: [{ ...base, amount: 30, direction: "outflow", splits: [{ amount: 20 }, { amount: 5 }] }],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/split lines add up to -25, but the transaction amount is -30/);
    expect(h.fake.calls.some((c) => c.method === "transactions.createTransaction")).toBe(false);
  });

  it("rejects contradictory fields", async () => {
    const h = setup();
    const both = await h.call(createTransactions, {
      transactions: [{ ...base, amount: 1, direction: "outflow", payee: "Employer", transferToAccount: "Credit Card" }],
    });
    expect(both.text).toMatch(/either payee or transferToAccount/);
    const splitWithCategory = await h.call(createTransactions, {
      transactions: [{ ...base, amount: 2, direction: "outflow", category: "Groceries", splits: [{ amount: 1 }, { amount: 1 }] }],
    });
    expect(splitWithCategory.text).toMatch(/categories on its lines/);
  });

  it("does not create the same transaction twice when a call is repeated", async () => {
    const h = setup();
    const request = { transactions: [{ ...base, amount: 7.25, direction: "outflow" as const, payee: "Downtown Cafe" }] };
    const first = await h.call(createTransactions, request);
    const second = await h.call(createTransactions, request);
    expect(first.data.created).toHaveLength(1);
    expect(second.data.created).toHaveLength(0);
    expect(second.data.skipped_duplicates[0]).toMatchObject({ index: 0, existing: { id: first.data.created[0].id } });
    const search = await h.call(searchTransactions, { sinceDate: base.date, untilDate: base.date });
    expect(search.data.total_matching).toBe(1);
  });

  it("creates a genuine repeat when allowDuplicate is set", async () => {
    const h = setup();
    const request = { transactions: [{ ...base, amount: 7.25, direction: "outflow" as const }] };
    await h.call(createTransactions, request);
    const again = await h.call(createTransactions, { ...request, allowDuplicate: true });
    expect(again.data.created).toHaveLength(1);
  });

  it("creates a batch in one request, with one duplicate check per account", async () => {
    const h = setup();
    const { data } = await h.call(createTransactions, {
      transactions: [
        { ...base, amount: 1, direction: "outflow" },
        { ...base, amount: 2, direction: "outflow" },
        { account: "Credit Card", date: "2024-02-16", amount: 3, direction: "outflow" },
      ],
    });
    expect(data.created).toHaveLength(3);
    const methods = h.fake.calls.map((c) => c.method);
    expect(methods.filter((m) => m === "transactions.createTransaction")).toHaveLength(1);
    expect(methods.filter((m) => m === "transactions.getTransactionsByAccount")).toHaveLength(2);
  });

  it("names the offending item when a name does not resolve", async () => {
    const h = setup();
    const result = await h.call(createTransactions, {
      transactions: [{ ...base, amount: 1, direction: "outflow", category: "Nope" }],
    });
    expect(result).toMatchObject({ isError: true });
    expect(result.text).toMatch(/No category matches "Nope"/);
  });

  it("returns created transactions in request order with their index, although the API reorders them", async () => {
    const h = setup();
    const { data } = await h.call(createTransactions, {
      transactions: [
        { ...base, amount: 30, direction: "outflow", splits: [{ amount: 20, category: "Groceries" }, { amount: 10, category: "Dining Out" }] },
        { ...base, amount: 40, direction: "outflow", transferToAccount: "Credit Card" },
        { ...base, amount: 5, direction: "inflow" },
      ],
    });
    expect(data.created.map((t: { index: number; amount: number }) => [t.index, t.amount])).toEqual([
      [0, -30],
      [1, -40],
      [2, 5],
    ]);
    expect(data.created[0].category).toBe("Split");
  });
});
