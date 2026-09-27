import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeYnab,
  accountFixture,
  categoryFixture,
  categoryGroupFixture,
  resetIds,
  standardPlan,
  transactionFixture,
  ynabError,
} from "./ynab.js";

// standardPlan()'s transactions are dated in January and February 2024, so
// every test that relies on "current month" resolution fixes `now` inside
// that range to keep category/month amounts deterministic.
const JAN_2024 = new Date("2024-01-15T00:00:00Z");

beforeEach(() => {
  resetIds();
});

describe("transaction ordering and filtering", () => {
  it("returns transactions oldest first, ties broken by insertion order", async () => {
    const fake = new FakeYnab();
    const account = accountFixture({ name: "Checking" });
    const planId = fake.addPlan({
      accounts: [account],
      transactions: [
        transactionFixture({ account_id: account.id, date: "2024-03-01", amount: -1000, memo: "third" }),
        transactionFixture({ account_id: account.id, date: "2024-01-01", amount: -1000, memo: "first" }),
        transactionFixture({ account_id: account.id, date: "2024-01-01", amount: -1000, memo: "second, same date as first" }),
      ],
    });

    const response = await fake.api.transactions.getTransactions(planId);

    expect(response.data.transactions.map((t) => t.memo)).toEqual(["first", "second, same date as first", "third"]);
  });

  it("filters by sinceDate and untilDate inclusively", async () => {
    const fake = new FakeYnab();
    const account = accountFixture({ name: "Checking" });
    const planId = fake.addPlan({
      accounts: [account],
      transactions: [
        transactionFixture({ account_id: account.id, date: "2024-01-05", amount: -1000, memo: "before" }),
        transactionFixture({ account_id: account.id, date: "2024-01-10", amount: -1000, memo: "since-boundary" }),
        transactionFixture({ account_id: account.id, date: "2024-01-15", amount: -1000, memo: "middle" }),
        transactionFixture({ account_id: account.id, date: "2024-01-20", amount: -1000, memo: "until-boundary" }),
        transactionFixture({ account_id: account.id, date: "2024-01-25", amount: -1000, memo: "after" }),
      ],
    });

    const response = await fake.api.transactions.getTransactions(planId, "2024-01-10", "2024-01-20");

    expect(response.data.transactions.map((t) => t.memo)).toEqual(["since-boundary", "middle", "until-boundary"]);
  });

  it("filters unapproved and uncategorized transactions", async () => {
    const fake = new FakeYnab({ now: JAN_2024 });
    const { seed } = standardPlan();
    const planId = fake.addPlan(seed);

    const unapproved = await fake.api.transactions.getTransactions(planId, undefined, undefined, "unapproved");
    expect(unapproved.data.transactions.every((t) => !t.approved)).toBe(true);
    expect(unapproved.data.transactions.length).toBeGreaterThan(0);

    const uncategorized = await fake.api.transactions.getTransactions(planId, undefined, undefined, "uncategorized");
    expect(uncategorized.data.transactions.every((t) => !t.category_id && !t.transfer_account_id)).toBe(true);
    // The initial deposit, the unknown-kiosk purchase and the February
    // paycheck are all uncategorized in the standard scenario.
    expect(uncategorized.data.transactions.length).toBe(3);
  });
});

describe("sign convention and balances", () => {
  it("an outflow lowers the account balance and an inflow raises it", async () => {
    const fake = new FakeYnab();
    const account = accountFixture({ name: "Checking" });
    const planId = fake.addPlan({
      accounts: [account],
      transactions: [
        transactionFixture({ account_id: account.id, date: "2024-01-01", amount: 100000 }),
        transactionFixture({ account_id: account.id, date: "2024-01-02", amount: -30000 }),
      ],
    });

    const response = await fake.api.accounts.getAccountById(planId, account.id);

    expect(response.data.account.balance).toBe(70000);
  });

  it("counts cleared and reconciled transactions in the cleared balance, but not uncleared ones", async () => {
    const fake = new FakeYnab();
    const account = accountFixture({ name: "Checking" });
    const planId = fake.addPlan({
      accounts: [account],
      transactions: [
        transactionFixture({ account_id: account.id, date: "2024-01-01", amount: 50000, cleared: "reconciled" }),
        transactionFixture({ account_id: account.id, date: "2024-01-02", amount: -20000, cleared: "uncleared" }),
      ],
    });

    const response = await fake.api.accounts.getAccountById(planId, account.id);

    expect(response.data.account.balance).toBe(30000);
    expect(response.data.account.cleared_balance).toBe(50000);
    expect(response.data.account.uncleared_balance).toBe(-20000);
  });
});

describe("transfers", () => {
  it("mirrors a transfer to the target account and links both sides", async () => {
    const fake = new FakeYnab({ now: JAN_2024 });
    const { seed, accounts } = standardPlan();
    const planId = fake.addPlan(seed);

    const cardTransactions = await fake.api.transactions.getTransactionsByAccount(planId, accounts.creditCard.id);
    const mirror = cardTransactions.data.transactions.find((t) => t.transfer_account_id === accounts.checking.id);

    expect(mirror).toBeDefined();
    expect(mirror!.amount).toBe(50000);

    const checkingTransactions = await fake.api.transactions.getTransactionsByAccount(planId, accounts.checking.id);
    const original = checkingTransactions.data.transactions.find((t) => t.transfer_account_id === accounts.creditCard.id);

    expect(original).toBeDefined();
    expect(original!.amount).toBe(-50000);
    expect(original!.transfer_transaction_id).toBe(mirror!.id);
    expect(mirror!.transfer_transaction_id).toBe(original!.id);
  });

  it("deletes both sides of a transfer pair", async () => {
    const fake = new FakeYnab({ now: JAN_2024 });
    const { seed, accounts } = standardPlan();
    const planId = fake.addPlan(seed);

    const checkingTransactions = await fake.api.transactions.getTransactionsByAccount(planId, accounts.checking.id);
    const original = checkingTransactions.data.transactions.find((t) => t.transfer_account_id === accounts.creditCard.id)!;

    await fake.api.transactions.deleteTransaction(planId, original.id);

    const afterDelete = await fake.api.transactions.getTransactionById(planId, original.transfer_transaction_id!);
    expect(afterDelete.data.transaction.deleted).toBe(true);
    const originalAfter = await fake.api.transactions.getTransactionById(planId, original.id);
    expect(originalAfter.data.transaction.deleted).toBe(true);
  });
});

describe("splits", () => {
  it("returns hybrid rows for both the parent and the matching subtransaction", async () => {
    const fake = new FakeYnab({ now: JAN_2024 });
    const { seed, categories } = standardPlan();
    const planId = fake.addPlan(seed);

    const response = await fake.api.transactions.getTransactionsByCategory(planId, categories.dining.id);
    const types = response.data.transactions.map((t) => t.type);

    // idx2 (unapproved cafe transaction), the split's dining subtransaction,
    // idx7 and idx8 (the credit card dining transaction) all match.
    expect(response.data.transactions).toHaveLength(4);
    expect(types).toContain("subtransaction");
    expect(types.filter((t) => t === "transaction")).toHaveLength(3);

    const splitRow = response.data.transactions.find((t) => t.type === "subtransaction")!;
    expect(splitRow.amount).toBe(-4000);
    expect(splitRow.category_name).toBe("Dining Out");
  });
});

describe("import_id duplicates", () => {
  it("reports a duplicate import_id and does not create a second transaction", async () => {
    const fake = new FakeYnab();
    const account = accountFixture({ name: "Checking" });
    const planId = fake.addPlan({ accounts: [account] });

    await fake.api.transactions.createTransaction(planId, {
      transaction: { account_id: account.id, date: "2024-01-01", amount: -1000, import_id: "dupe-1" },
    });
    const second = await fake.api.transactions.createTransaction(planId, {
      transaction: { account_id: account.id, date: "2024-01-02", amount: -2000, import_id: "dupe-1" },
    });

    expect(second.data.duplicate_import_ids).toEqual(["dupe-1"]);
    expect(second.data.transaction).toBeUndefined();

    const all = await fake.api.transactions.getTransactionsByAccount(planId, account.id);
    expect(all.data.transactions).toHaveLength(1);
  });
});

describe("delta requests", () => {
  it("returns only entities changed since lastKnowledgeOfServer", async () => {
    const fake = new FakeYnab();
    const first = accountFixture({ name: "Checking" });
    const planId = fake.addPlan({ accounts: [first] });

    const initial = await fake.api.accounts.getAccounts(planId);
    const knowledge = initial.data.server_knowledge;

    await fake.api.accounts.createAccount(planId, { account: { name: "Savings", type: "savings", balance: 0 } });

    const delta = await fake.api.accounts.getAccounts(planId, knowledge);
    expect(delta.data.accounts.map((a) => a.name)).toEqual(["Savings"]);
    expect(delta.data.server_knowledge).toBeGreaterThan(knowledge);

    const full = await fake.api.accounts.getAccounts(planId, undefined);
    expect(full.data.accounts.map((a) => a.name).sort()).toEqual(["Checking", "Savings"]);
  });
});

describe("plan resolution", () => {
  it("resolves \"last-used\" to the first plan added", async () => {
    const fake = new FakeYnab();
    const planId = fake.addPlan({ name: "First Plan" });
    fake.addPlan({ name: "Second Plan" });

    const response = await fake.api.plans.getPlanById("last-used");

    expect(response.data.plan.id).toBe(planId);
    expect(response.data.plan.name).toBe("First Plan");
  });

  it("throws a YNAB-shaped 404 for an unknown plan or entity", async () => {
    const fake = new FakeYnab();
    const planId = fake.addPlan();

    await expect(fake.api.plans.getPlanById("does-not-exist")).rejects.toEqual(
      ynabError("404.2", "resource_not_found", "Resource not found")
    );
    await expect(fake.api.accounts.getAccountById(planId, "does-not-exist")).rejects.toEqual(
      ynabError("404.2", "resource_not_found", "Resource not found")
    );
  });
});

describe("failNext", () => {
  it("throws the queued error exactly once, then behaves normally", async () => {
    const fake = new FakeYnab();
    const planId = fake.addPlan();
    fake.failNext("accounts.getAccounts", ynabError("429", "too_many_requests", "Too many requests"));

    await expect(fake.api.accounts.getAccounts(planId)).rejects.toEqual(
      ynabError("429", "too_many_requests", "Too many requests")
    );
    await expect(fake.api.accounts.getAccounts(planId)).resolves.toMatchObject({ data: { accounts: [] } });
  });
});

describe("call recording", () => {
  it("records every call with its method name and arguments", async () => {
    const fake = new FakeYnab();
    const planId = fake.addPlan();

    await fake.api.accounts.getAccounts(planId);
    await fake.api.accounts.getAccounts(planId, 5);

    expect(fake.calls).toEqual([
      { method: "accounts.getAccounts", args: [planId, undefined] },
      { method: "accounts.getAccounts", args: [planId, 5] },
    ]);
  });
});

describe("months and categories", () => {
  it("computes category activity and balance after updateMonthCategory", async () => {
    const fake = new FakeYnab();
    const account = accountFixture({ name: "Checking" });
    const group = categoryGroupFixture({ name: "Everyday Expenses" });
    const groceries = categoryFixture({ category_group_id: group.id, name: "Groceries" });
    const planId = fake.addPlan({
      accounts: [account],
      categoryGroups: [group],
      categories: [groceries],
      transactions: [
        transactionFixture({ account_id: account.id, date: "2024-03-05", amount: -5000, category_id: groceries.id }),
        transactionFixture({ account_id: account.id, date: "2024-03-10", amount: -1500, category_id: groceries.id }),
      ],
    });

    await fake.api.categories.updateMonthCategory(planId, "2024-03-01", groceries.id, { category: { budgeted: 20000 } });
    const response = await fake.api.categories.getMonthCategoryById(planId, "2024-03-01", groceries.id);

    expect(response.data.category.budgeted).toBe(20000);
    expect(response.data.category.activity).toBe(-6500);
    expect(response.data.category.balance).toBe(13500);

    // A different month for the same category starts from zero.
    const otherMonth = await fake.api.categories.getMonthCategoryById(planId, "2024-04-01", groceries.id);
    expect(otherMonth.data.category.budgeted).toBe(0);
    expect(otherMonth.data.category.activity).toBe(0);
  });
});

describe("id allocation", () => {
  it("never reuses a fixture id built before resetIds for an id the fake generates", async () => {
    const { seed } = standardPlan();
    resetIds();
    const fake = new FakeYnab();
    const planId = fake.addPlan(seed);
    const payees = (await fake.api.payees.getPayees(planId)).data.payees;
    expect(new Set(payees.map((p) => p.id)).size).toBe(payees.length);
    for (const payee of seed.payees ?? []) expect(payees.map((p) => p.name)).toContain(payee.name);
    const transfers = (await fake.api.transactions.getTransactions(planId)).data.transactions.filter((t) => t.transfer_account_id);
    expect(transfers).toHaveLength(2);
  });
});
