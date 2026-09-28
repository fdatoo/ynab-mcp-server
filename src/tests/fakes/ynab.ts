// In-memory fake of the parts of ynab.API this project's tools call.
//
// The real API has two behaviours that ad hoc per-method mocks routinely get
// wrong and that this fake exists to catch:
//   - transactions come back sorted oldest-first by date
//   - amounts are milliunits, and a positive amount is an inflow (an outflow
//     is negative), so an "expense" lowers a balance by subtracting a
//     negative number
// Every computed field (balances, category activity, month totals) is
// derived from stored transactions at read time rather than cached, so a
// bug in that derivation shows up the moment a test reads it back.
import * as ynab from "ynab";

// The type of a single method on the real ynab.API, e.g. Method<"accounts",
// "getAccounts">. Used to annotate each fake method individually: ynab.API's
// getters return classes (AccountsApi, CategoriesApi, ...), and those classes
// have a protected `configuration` field, which makes TypeScript compare them
// nominally rather than structurally. A plain object can never satisfy a
// class type for that reason, but it can satisfy the type of one of that
// class's public methods, which is all a structural function-type check.
type Method<N extends keyof ynab.API, M extends keyof ynab.API[N]> = ynab.API[N][M];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Builds the JSON body the real YNAB API throws on error responses. */
export function ynabError(id: string, name: string, detail: string): ynab.ErrorResponse {
  return { error: { id, name, detail } };
}

function notFound(): never {
  throw ynabError("404.2", "resource_not_found", "Resource not found");
}

// ---------------------------------------------------------------------------
// Id generation
// ---------------------------------------------------------------------------

// A single set of counters shared by the fixture builders and by FakeYnab's
// own create* methods, so ids assigned by a fixture (e.g. accountFixture())
// never collide with ids the fake assigns itself (e.g. inside createAccount).
// Fixtures are often built before resetIds() runs (e.g. as an argument to a
// setup helper), so a generated id also skips any id already known to be taken.
const idCounters = new Map<string, number>();
const takenIds = new Set<string>();

function nextId(prefix: string, explicit?: string): string {
  if (explicit) {
    takenIds.add(explicit);
    return explicit;
  }
  let n = idCounters.get(prefix) ?? 0;
  let id: string;
  do {
    n += 1;
    id = `${prefix}-${n}`;
  } while (takenIds.has(id));
  idCounters.set(prefix, n);
  takenIds.add(id);
  return id;
}

function reserveIds(seed: PlanSeed): void {
  const entities: Array<{ id?: string } | undefined> = [
    ...(seed.accounts ?? []),
    ...(seed.payees ?? []),
    ...(seed.categoryGroups ?? []),
    ...(seed.categories ?? []),
    ...(seed.transactions ?? []),
    ...(seed.scheduledTransactions ?? []),
  ];
  for (const entity of entities) if (entity?.id) takenIds.add(entity.id);
}

/** Resets every id counter. Call between tests that care about exact ids. */
export function resetIds(): void {
  idCounters.clear();
  takenIds.clear();
}

// ---------------------------------------------------------------------------
// Money formatting
// ---------------------------------------------------------------------------

function decimalAmount(milliunits: number, currency: ynab.CurrencyFormat): number {
  const digits = Math.min(currency.decimal_digits, 3);
  return Number((milliunits / 1000).toFixed(digits));
}

function formatMoney(milliunits: number, currency: ynab.CurrencyFormat): string {
  const digits = Math.min(currency.decimal_digits, 3);
  const [whole, fraction] = Math.abs(milliunits / 1000)
    .toFixed(digits)
    .split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, currency.group_separator);
  const body = fraction ? `${grouped}${currency.decimal_separator}${fraction}` : grouped;
  const withSymbol = !currency.display_symbol
    ? body
    : currency.symbol_first
      ? `${currency.currency_symbol}${body}`
      : `${body}${currency.currency_symbol}`;
  return milliunits < 0 ? `-${withSymbol}` : withSymbol;
}

export const USD_CURRENCY: ynab.CurrencyFormat = {
  iso_code: "USD",
  example_format: "123,456.78",
  decimal_digits: 2,
  decimal_separator: ".",
  symbol_first: true,
  group_separator: ",",
  currency_symbol: "$",
  display_symbol: true,
};

const DEFAULT_DATE_FORMAT: ynab.DateFormat = { format: "MM/DD/YYYY" };

// ---------------------------------------------------------------------------
// Internal storage shapes
//
// Stored records hold only the fields the API can't derive: no
// account_name/payee_name/category_name and no *_formatted/*_currency.
// Those are filled in by the materialize* functions on every read, per the
// task's "denormalize on every read" requirement, so a rename is reflected
// immediately in every transaction that references it.
// ---------------------------------------------------------------------------

type StoredSubtransaction = Omit<ynab.SubTransaction, "payee_name" | "category_name" | "amount_formatted" | "amount_currency">;

type StoredTransaction = Omit<
  ynab.TransactionDetail,
  "account_name" | "payee_name" | "category_name" | "amount_formatted" | "amount_currency" | "subtransactions"
> & { subtransactions: StoredSubtransaction[] };

type StoredScheduledSubtransaction = Omit<ynab.ScheduledSubTransaction, "payee_name" | "category_name" | "amount_formatted" | "amount_currency">;

type StoredScheduledTransaction = Omit<
  ynab.ScheduledTransactionDetail,
  "account_name" | "payee_name" | "category_name" | "amount_formatted" | "amount_currency" | "subtransactions"
> & { subtransactions: StoredScheduledSubtransaction[] };

interface PlanState {
  id: string;
  name: string;
  lastModifiedOn: string | undefined;
  currency: ynab.CurrencyFormat;
  dateFormat: ynab.DateFormat;
  accounts: Map<string, ynab.Account>;
  payees: Map<string, ynab.Payee>;
  categoryGroups: Map<string, ynab.CategoryGroup>;
  categories: Map<string, ynab.Category>;
  // budgeted amount per (month, category), keyed by `${month}|${categoryId}`
  monthlyBudgeted: Map<string, number>;
  transactions: Map<string, StoredTransaction>;
  scheduledTransactions: Map<string, StoredScheduledTransaction>;
  moneyMovements: Map<string, ynab.MoneyMovement>;
  importQueue: TransactionSeed[];
  // knowledge stamp per `${kind}:${id}`, bumped on every write
  knowledge: Map<string, number>;
  serverKnowledge: number;
}

function touch(plan: PlanState, kind: string, id: string): void {
  plan.serverKnowledge += 1;
  plan.knowledge.set(`${kind}:${id}`, plan.serverKnowledge);
}

function changedSince(plan: PlanState, kind: string, id: string, since: number | undefined): boolean {
  if (since === undefined) return true;
  return (plan.knowledge.get(`${kind}:${id}`) ?? 0) > since;
}

// ---------------------------------------------------------------------------
// Month helpers
// ---------------------------------------------------------------------------

function firstOfMonth(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function normalizeMonth(month: string, now: Date): string {
  if (month === "current") return firstOfMonth(now);
  return `${month.slice(0, 7)}-01`;
}

/** Exclusive end: the first day of the month after `monthIso`. */
function nextMonth(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return firstOfMonth(d);
}

function monthOf(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}

function budgetKey(monthIso: string, categoryId: string): string {
  return `${monthIso}|${categoryId}`;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------
// Sorting / filtering shared by every transaction-list endpoint
// ---------------------------------------------------------------------------

type TxnType = "uncategorized" | "unapproved";

function isUncategorized(t: StoredTransaction): boolean {
  return !t.category_id && !t.transfer_account_id && t.subtransactions.length === 0;
}

// The real API's type=uncategorized also returns transfer legs between the
// user's own accounts (verified live), which carry no category either.
function matchesUncategorizedFilter(t: StoredTransaction): boolean {
  return !t.category_id && t.subtransactions.length === 0;
}

function matchesType(t: StoredTransaction, type: TxnType | undefined): boolean {
  if (!type) return true;
  if (type === "unapproved") return !t.approved;
  return matchesUncategorizedFilter(t);
}

/** Oldest-first by date, ties broken by insertion order (this is what the real API does). */
function sortByDate<T extends { date: string }>(items: T[]): T[] {
  return items
    .map((item, insertionIndex) => ({ item, insertionIndex }))
    .sort((a, b) => (a.item.date === b.item.date ? a.insertionIndex - b.insertionIndex : a.item.date < b.item.date ? -1 : 1))
    .map(({ item }) => item);
}

function selectTransactions(
  plan: PlanState,
  filter: { accountId?: string; month?: string; sinceDate?: string; untilDate?: string; type?: TxnType }
): StoredTransaction[] {
  let list = [...plan.transactions.values()];
  if (filter.accountId) list = list.filter((t) => t.account_id === filter.accountId);
  if (filter.month) {
    const end = nextMonth(filter.month);
    list = list.filter((t) => t.date >= filter.month! && t.date < end);
  }
  if (filter.sinceDate) list = list.filter((t) => t.date >= filter.sinceDate!);
  if (filter.untilDate) list = list.filter((t) => t.date <= filter.untilDate!);
  list = list.filter((t) => matchesType(t, filter.type));
  // Deliberately not filtering `deleted` here: list endpoints return every
  // stored entity including deleted ones, exactly like the real API's
  // delta responses. Tool code is expected to filter `deleted` itself.
  return sortByDate(list);
}

// ---------------------------------------------------------------------------
// Materialization: fills in denormalized names and *_formatted/*_currency
// ---------------------------------------------------------------------------

function materializeSubtransaction(plan: PlanState, s: StoredSubtransaction): ynab.SubTransaction {
  const payee = s.payee_id ? plan.payees.get(s.payee_id) : undefined;
  const category = s.category_id ? plan.categories.get(s.category_id) : undefined;
  return {
    ...s,
    payee_name: payee?.name,
    category_name: category?.name,
    amount_formatted: formatMoney(s.amount, plan.currency),
    amount_currency: decimalAmount(s.amount, plan.currency),
  };
}

function materializeTransaction(plan: PlanState, t: StoredTransaction): ynab.TransactionDetail {
  const account = plan.accounts.get(t.account_id);
  const payee = t.payee_id ? plan.payees.get(t.payee_id) : undefined;
  const category = t.category_id ? plan.categories.get(t.category_id) : undefined;
  const split = t.subtransactions.length > 0;
  return {
    ...t,
    account_name: account?.name ?? "",
    payee_name: payee?.name ?? null,
    category_name: split ? "Split" : category?.name ?? null,
    amount_formatted: formatMoney(t.amount, plan.currency),
    amount_currency: decimalAmount(t.amount, plan.currency),
    subtransactions: t.subtransactions.map((s) => materializeSubtransaction(plan, s)),
  };
}

function materializeAccount(plan: PlanState, account: ynab.Account): ynab.Account {
  const txns = [...plan.transactions.values()].filter((t) => t.account_id === account.id && !t.deleted);
  const balance = sum(txns.map((t) => t.amount));
  // Cleared and reconciled transactions both count toward the cleared balance.
  const cleared = sum(txns.filter((t) => t.cleared !== "uncleared").map((t) => t.amount));
  const uncleared = balance - cleared;
  return {
    ...account,
    balance,
    cleared_balance: cleared,
    uncleared_balance: uncleared,
    balance_formatted: formatMoney(balance, plan.currency),
    balance_currency: decimalAmount(balance, plan.currency),
    cleared_balance_formatted: formatMoney(cleared, plan.currency),
    cleared_balance_currency: decimalAmount(cleared, plan.currency),
    uncleared_balance_formatted: formatMoney(uncleared, plan.currency),
    uncleared_balance_currency: decimalAmount(uncleared, plan.currency),
  };
}

/** Sum of this category's activity for one month, including subtransactions of splits. */
function categoryActivity(plan: PlanState, categoryId: string, monthIso: string): number {
  const end = nextMonth(monthIso);
  let total = 0;
  for (const t of plan.transactions.values()) {
    if (t.deleted || t.date < monthIso || t.date >= end) continue;
    if (t.subtransactions.length > 0) {
      for (const s of t.subtransactions) {
        if (!s.deleted && s.category_id === categoryId) total += s.amount;
      }
    } else if (t.category_id === categoryId) {
      total += t.amount;
    }
  }
  return total;
}

function materializeCategory(plan: PlanState, category: ynab.Category, monthIso: string): ynab.Category {
  const budgeted = plan.monthlyBudgeted.get(budgetKey(monthIso, category.id)) ?? 0;
  const activity = categoryActivity(plan, category.id, monthIso);
  const balance = budgeted + activity;
  const group = plan.categoryGroups.get(category.category_group_id);
  return {
    ...category,
    category_group_name: group?.name,
    budgeted,
    activity,
    balance,
    budgeted_formatted: formatMoney(budgeted, plan.currency),
    budgeted_currency: decimalAmount(budgeted, plan.currency),
    activity_formatted: formatMoney(activity, plan.currency),
    activity_currency: decimalAmount(activity, plan.currency),
    balance_formatted: formatMoney(balance, plan.currency),
    balance_currency: decimalAmount(balance, plan.currency),
  };
}

// Income is approximated as uncategorized, non-transfer inflows dated in the
// month: there is no real "Inflow: Ready to Assign" category in this fake,
// and to_be_budgeted ignores month-to-month rollover. Both are simplifications
// the task explicitly allows; nothing in this project reads them precisely.
function materializeMonth(plan: PlanState, monthIso: string): ynab.MonthDetail {
  const end = nextMonth(monthIso);
  const income = sum(
    [...plan.transactions.values()]
      .filter((t) => !t.deleted && t.date >= monthIso && t.date < end && isUncategorized(t) && t.amount > 0)
      .map((t) => t.amount)
  );
  const categories = [...plan.categories.values()].map((c) => materializeCategory(plan, c, monthIso));
  const budgeted = sum(categories.map((c) => c.budgeted));
  const activity = sum(categories.map((c) => c.activity));
  const toBeBudgeted = income - budgeted;
  return {
    month: monthIso,
    income,
    budgeted,
    activity,
    to_be_budgeted: toBeBudgeted,
    deleted: false,
    income_formatted: formatMoney(income, plan.currency),
    income_currency: decimalAmount(income, plan.currency),
    budgeted_formatted: formatMoney(budgeted, plan.currency),
    budgeted_currency: decimalAmount(budgeted, plan.currency),
    activity_formatted: formatMoney(activity, plan.currency),
    activity_currency: decimalAmount(activity, plan.currency),
    to_be_budgeted_formatted: formatMoney(toBeBudgeted, plan.currency),
    to_be_budgeted_currency: decimalAmount(toBeBudgeted, plan.currency),
    categories,
  };
}

function materializeScheduledSubtransaction(plan: PlanState, s: StoredScheduledSubtransaction): ynab.ScheduledSubTransaction {
  const payee = s.payee_id ? plan.payees.get(s.payee_id) : undefined;
  const category = s.category_id ? plan.categories.get(s.category_id) : undefined;
  return {
    ...s,
    payee_name: payee?.name,
    category_name: category?.name,
    amount_formatted: formatMoney(s.amount, plan.currency),
    amount_currency: decimalAmount(s.amount, plan.currency),
  };
}

function materializeScheduled(plan: PlanState, t: StoredScheduledTransaction): ynab.ScheduledTransactionDetail {
  const account = plan.accounts.get(t.account_id);
  const payee = t.payee_id ? plan.payees.get(t.payee_id) : undefined;
  const category = t.category_id ? plan.categories.get(t.category_id) : undefined;
  const split = t.subtransactions.length > 0;
  return {
    ...t,
    account_name: account?.name ?? "",
    payee_name: payee?.name ?? null,
    category_name: split ? "Split" : category?.name ?? null,
    amount_formatted: formatMoney(t.amount, plan.currency),
    amount_currency: decimalAmount(t.amount, plan.currency),
    subtransactions: t.subtransactions.map((s) => materializeScheduledSubtransaction(plan, s)),
  };
}

// ---------------------------------------------------------------------------
// Payee resolution shared by transaction and scheduled-transaction creation
// ---------------------------------------------------------------------------

function resolvePayee(
  plan: PlanState,
  input: { payee_id?: string | null; payee_name?: string | null }
): { payeeId: string | undefined } {
  if (input.payee_id) {
    if (!plan.payees.has(input.payee_id)) notFound();
    return { payeeId: input.payee_id };
  }
  if (input.payee_name) {
    const existing = [...plan.payees.values()].find((p) => !p.deleted && p.name === input.payee_name);
    if (existing) return { payeeId: existing.id };
    const id = nextId("payee");
    const payee: ynab.Payee = { id, name: input.payee_name, transfer_account_id: null, deleted: false };
    plan.payees.set(id, payee);
    touch(plan, "payee", id);
    return { payeeId: id };
  }
  return { payeeId: undefined };
}

// ---------------------------------------------------------------------------
// Transaction creation (shared by createTransaction, createTransactions,
// importTransactions and plan seeding)
// ---------------------------------------------------------------------------

export interface TransactionSeed {
  id?: string;
  account_id: string;
  date: string;
  amount: number;
  payee_id?: string;
  payee_name?: string;
  category_id?: string;
  memo?: string;
  cleared?: ynab.TransactionClearedStatus;
  approved?: boolean;
  flag_color?: ynab.TransactionFlagColor | null;
  import_id?: string | null;
  subtransactions?: ynab.SaveSubTransaction[];
  /**
   * Seeding-only convenience: creates a transfer to this account instead of
   * requiring the caller to already know the target account's transfer
   * payee id (which is only assigned once the target account exists).
   */
  transfer_to_account_id?: string;
}

interface CreateOutcome {
  created?: ynab.TransactionDetail;
  duplicateImportId?: string;
}

/**
 * Links a transaction to a new mirror on `targetAccountId`, the way selecting
 * an account's transfer payee does on either create or update.
 */
function createTransferMirror(plan: PlanState, original: StoredTransaction, targetAccountId: string): void {
  const sourceAccount = plan.accounts.get(original.account_id)!;
  const mirrorId = nextId("txn");
  const mirror: StoredTransaction = {
    id: mirrorId,
    date: original.date,
    amount: -original.amount,
    memo: original.memo,
    cleared: original.cleared,
    approved: original.approved,
    flag_color: undefined,
    flag_name: undefined,
    account_id: targetAccountId,
    payee_id: sourceAccount.transfer_payee_id,
    category_id: undefined,
    transfer_account_id: original.account_id,
    transfer_transaction_id: original.id,
    matched_transaction_id: undefined,
    import_id: undefined,
    import_payee_name: undefined,
    import_payee_name_original: undefined,
    debt_transaction_type: undefined,
    deleted: false,
    subtransactions: [],
  };
  plan.transactions.set(mirrorId, mirror);
  touch(plan, "transaction", mirrorId);
  touch(plan, "month", monthOf(mirror.date));
  original.transfer_account_id = targetAccountId;
  original.transfer_transaction_id = mirrorId;
}

/** Builds stored subtransactions for a new split, resolving each line's payee. */
function buildSubtransactions(plan: PlanState, transactionId: string, subs: ynab.SaveSubTransaction[]): StoredSubtransaction[] {
  return subs.map((s) => {
    const { payeeId: subPayeeId } = resolvePayee(plan, s);
    return {
      id: nextId("sub"),
      transaction_id: transactionId,
      amount: s.amount,
      memo: s.memo ?? undefined,
      payee_id: subPayeeId,
      category_id: s.category_id ?? undefined,
      transfer_account_id: undefined,
      transfer_transaction_id: undefined,
      deleted: false,
    };
  });
}

function createOneTransaction(
  plan: PlanState,
  rawInput: ynab.NewTransaction & { id?: string; transfer_to_account_id?: string }
): CreateOutcome {
  const input = rawInput.transfer_to_account_id
    ? { ...rawInput, payee_id: plan.accounts.get(rawInput.transfer_to_account_id)?.transfer_payee_id }
    : rawInput;
  if (!input.account_id) throw new Error("account_id is required to create a transaction");
  if (!plan.accounts.has(input.account_id)) notFound();

  if (input.import_id) {
    const duplicate = [...plan.transactions.values()].some(
      (t) => !t.deleted && t.account_id === input.account_id && t.import_id === input.import_id
    );
    if (duplicate) return { duplicateImportId: input.import_id };
  }

  const { payeeId } = resolvePayee(plan, input);
  const transferTarget = payeeId ? plan.payees.get(payeeId) : undefined;
  const isTransfer = !!transferTarget?.transfer_account_id && transferTarget.transfer_account_id !== input.account_id;

  const id = nextId("txn", input.id);
  const subtransactions = buildSubtransactions(plan, id, input.subtransactions ?? []);

  const stored: StoredTransaction = {
    id,
    date: input.date ?? "",
    amount: input.amount ?? 0,
    memo: input.memo ?? undefined,
    cleared: input.cleared ?? "uncleared",
    approved: input.approved ?? false,
    flag_color: input.flag_color ?? undefined,
    flag_name: undefined,
    account_id: input.account_id,
    payee_id: payeeId,
    category_id: subtransactions.length ? undefined : (input.category_id ?? undefined),
    transfer_account_id: undefined,
    transfer_transaction_id: undefined,
    matched_transaction_id: undefined,
    import_id: input.import_id ?? undefined,
    import_payee_name: undefined,
    import_payee_name_original: undefined,
    debt_transaction_type: undefined,
    deleted: false,
    subtransactions,
  };
  plan.transactions.set(id, stored);
  touch(plan, "transaction", id);
  touch(plan, "month", monthOf(stored.date));

  if (isTransfer) createTransferMirror(plan, stored, transferTarget!.transfer_account_id!);

  return { created: materializeTransaction(plan, stored) };
}

// ---------------------------------------------------------------------------
// Plan seed input, consumed by FakeYnab.addPlan
// ---------------------------------------------------------------------------

export interface PlanSeed {
  id?: string;
  name?: string;
  last_modified_on?: string;
  currency_format?: ynab.CurrencyFormat;
  date_format?: ynab.DateFormat;
  accounts?: ynab.Account[];
  payees?: ynab.Payee[];
  categoryGroups?: ynab.CategoryGroup[];
  categories?: Array<ynab.Category & { budgetedByMonth?: Record<string, number> }>;
  transactions?: TransactionSeed[];
  scheduledTransactions?: StoredScheduledTransaction[];
  moneyMovements?: ynab.MoneyMovement[];
}

// ---------------------------------------------------------------------------
// FakeYnab
// ---------------------------------------------------------------------------

export interface CallRecord {
  method: string;
  args: unknown[];
}

export class FakeYnab {
  private plans = new Map<string, PlanState>();
  private firstPlanId: string | undefined;
  private failures = new Map<string, unknown[]>();
  readonly calls: CallRecord[] = [];
  private now: Date;

  constructor(options: { now?: Date } = {}) {
    this.now = options.now ?? new Date();
  }

  /** Adds a plan built from a PlanSeed (see the fixture builders below) and returns its id. */
  addPlan(seed: PlanSeed = {}): string {
    reserveIds(seed);
    const id = nextId("plan", seed.id);
    const plan: PlanState = {
      id,
      name: seed.name ?? "Test Plan",
      lastModifiedOn: seed.last_modified_on,
      currency: seed.currency_format ?? USD_CURRENCY,
      dateFormat: seed.date_format ?? DEFAULT_DATE_FORMAT,
      accounts: new Map(),
      payees: new Map(),
      categoryGroups: new Map(),
      categories: new Map(),
      monthlyBudgeted: new Map(),
      transactions: new Map(),
      scheduledTransactions: new Map(),
      moneyMovements: new Map(),
      importQueue: [],
      knowledge: new Map(),
      serverKnowledge: 0,
    };
    this.plans.set(id, plan);
    if (!this.firstPlanId) this.firstPlanId = id;

    for (const account of seed.accounts ?? []) {
      plan.accounts.set(account.id, account);
      const payeeId = nextId("payee");
      const transferPayee: ynab.Payee = { id: payeeId, name: `Transfer : ${account.name}`, transfer_account_id: account.id, deleted: false };
      plan.payees.set(payeeId, transferPayee);
      account.transfer_payee_id = payeeId;
      touch(plan, "account", account.id);
      touch(plan, "payee", payeeId);
    }
    for (const payee of seed.payees ?? []) {
      plan.payees.set(payee.id, payee);
      touch(plan, "payee", payee.id);
    }
    for (const group of seed.categoryGroups ?? []) {
      plan.categoryGroups.set(group.id, group);
      touch(plan, "categoryGroup", group.id);
    }
    for (const category of seed.categories ?? []) {
      const { budgetedByMonth, ...rest } = category;
      plan.categories.set(category.id, rest);
      touch(plan, "category", category.id);
      const byMonth = budgetedByMonth ?? { [firstOfMonth(this.now)]: category.budgeted };
      for (const [month, budgeted] of Object.entries(byMonth)) {
        plan.monthlyBudgeted.set(budgetKey(normalizeMonth(month, this.now), category.id), budgeted);
      }
    }
    for (const seededTxn of seed.transactions ?? []) {
      createOneTransaction(plan, seededTxn);
    }
    for (const scheduled of seed.scheduledTransactions ?? []) {
      plan.scheduledTransactions.set(scheduled.id, scheduled);
      touch(plan, "scheduledTransaction", scheduled.id);
    }
    for (const movement of seed.moneyMovements ?? []) {
      plan.moneyMovements.set(movement.id, movement);
    }
    return id;
  }

  /** Queues transaction seeds that the next importTransactions call for this plan will create. */
  queueImport(planId: string, seeds: TransactionSeed[]): void {
    this.getPlan(planId).importQueue.push(...seeds);
  }

  /** Makes the next call to `method` (e.g. "transactions.getTransactions") throw `error`. */
  failNext(method: string, error: unknown): void {
    const queue = this.failures.get(method) ?? [];
    queue.push(error);
    this.failures.set(method, queue);
  }

  private getPlan(planId: string): PlanState {
    const resolved = planId === "last-used" ? this.firstPlanId : planId;
    const plan = resolved ? this.plans.get(resolved) : undefined;
    if (!plan) notFound();
    return plan;
  }

  // Every method wrapped by `call` returns a Promise, exactly like the real
  // API (which only ever rejects, asynchronously, on error). A synchronous
  // throw from `fn` (e.g. notFound()) or a queued failNext error is turned
  // into a rejected Promise here so callers can always `await` or use
  // `.catch`/`.rejects` rather than needing a try/catch around the call itself.
  private call<T>(method: string, args: unknown[], fn: () => T): T {
    this.calls.push({ method, args });
    const queue = this.failures.get(method);
    if (queue?.length) return Promise.reject(queue.shift()) as T;
    try {
      return fn();
    } catch (error) {
      return Promise.reject(error) as T;
    }
  }

  get api(): ynab.API {
    const fake = this;

    const plans = {
      getPlans: (includeAccounts?: boolean) =>
        fake.call("plans.getPlans", [includeAccounts], () => {
          const summaries: ynab.PlanSummary[] = [...fake.plans.values()].map((plan) => ({
            id: plan.id,
            name: plan.name,
            last_modified_on: plan.lastModifiedOn,
            date_format: plan.dateFormat,
            currency_format: plan.currency,
          }));
          return Promise.resolve({ data: { plans: summaries, default_plan: summaries[0] } });
        }),
      getPlanById: (planId: string, lastKnowledgeOfServer?: number) =>
        fake.call("plans.getPlanById", [planId, lastKnowledgeOfServer], () => {
          const plan = fake.getPlan(planId);
          const detail: ynab.PlanDetail = {
            id: plan.id,
            name: plan.name,
            date_format: plan.dateFormat,
            currency_format: plan.currency,
            accounts: [...plan.accounts.values()].map((a) => materializeAccount(plan, a)),
            payees: [...plan.payees.values()],
            category_groups: [...plan.categoryGroups.values()],
            categories: [...plan.categories.values()].map((c) => materializeCategory(plan, c, firstOfMonth(fake.now))),
            transactions: [...plan.transactions.values()].map((t) => materializeTransaction(plan, t)),
            subtransactions: [...plan.transactions.values()].flatMap((t) => t.subtransactions.map((s) => materializeSubtransaction(plan, s))),
            scheduled_transactions: [...plan.scheduledTransactions.values()].map((s) => materializeScheduled(plan, s)),
            scheduled_subtransactions: [],
            months: [],
            payee_locations: [],
          };
          return Promise.resolve({ data: { plan: detail, server_knowledge: plan.serverKnowledge } });
        }),
      getPlanSettingsById: (planId: string) =>
        fake.call("plans.getPlanSettingsById", [planId], () => {
          const plan = fake.getPlan(planId);
          return Promise.resolve({ data: { settings: { date_format: plan.dateFormat, currency_format: plan.currency } } });
        }),
    };

    const accounts = {
      getAccounts: (planId: string, lastKnowledgeOfServer?: number) =>
        fake.call("accounts.getAccounts", [planId, lastKnowledgeOfServer], () => {
          const plan = fake.getPlan(planId);
          const list = [...plan.accounts.values()]
            .filter((a) => changedSince(plan, "account", a.id, lastKnowledgeOfServer))
            .map((a) => materializeAccount(plan, a));
          return Promise.resolve({ data: { accounts: list, server_knowledge: plan.serverKnowledge } });
        }),
      getAccountById: (planId: string, accountId: string) =>
        fake.call("accounts.getAccountById", [planId, accountId], () => {
          const plan = fake.getPlan(planId);
          const account = plan.accounts.get(accountId);
          if (!account) notFound();
          return Promise.resolve({ data: { account: materializeAccount(plan, account) } });
        }),
      createAccount: (planId: string, data: ynab.PostAccountWrapper) =>
        fake.call("accounts.createAccount", [planId, data], () => {
          const plan = fake.getPlan(planId);
          const id = nextId("acct");
          const account: ynab.Account = {
            id,
            name: data.account.name,
            type: data.account.type,
            on_budget: data.account.type !== "otherAsset" && data.account.type !== "otherLiability",
            closed: false,
            balance: 0,
            cleared_balance: 0,
            uncleared_balance: 0,
            transfer_payee_id: "",
            deleted: false,
          };
          plan.accounts.set(id, account);
          const payeeId = nextId("payee");
          plan.payees.set(payeeId, { id: payeeId, name: `Transfer : ${account.name}`, transfer_account_id: id, deleted: false });
          account.transfer_payee_id = payeeId;
          touch(plan, "account", id);
          touch(plan, "payee", payeeId);
          if (data.account.balance) {
            createOneTransaction(plan, {
              account_id: id,
              date: firstOfMonth(fake.now),
              amount: data.account.balance,
              payee_name: "Starting Balance",
              cleared: "cleared",
              approved: true,
            });
          }
          return Promise.resolve({ data: { account: materializeAccount(plan, account) } });
        }),
    };

    const categories = {
      getCategories: (planId: string, lastKnowledgeOfServer?: number) =>
        fake.call("categories.getCategories", [planId, lastKnowledgeOfServer], () => {
          const plan = fake.getPlan(planId);
          const month = firstOfMonth(fake.now);
          const groups: ynab.CategoryGroupWithCategories[] = [];
          for (const group of plan.categoryGroups.values()) {
            const categoriesInGroup = [...plan.categories.values()].filter((c) => c.category_group_id === group.id);
            const materialized = categoriesInGroup.map((c) => materializeCategory(plan, c, month));
            if (lastKnowledgeOfServer === undefined) {
              groups.push({ ...group, categories: materialized });
              continue;
            }
            const groupChanged = changedSince(plan, "categoryGroup", group.id, lastKnowledgeOfServer);
            const changedCategories = materialized.filter((c) => changedSince(plan, "category", c.id, lastKnowledgeOfServer));
            if (groupChanged || changedCategories.length) {
              groups.push({ ...group, categories: groupChanged ? materialized : changedCategories });
            }
          }
          return Promise.resolve({ data: { category_groups: groups, server_knowledge: plan.serverKnowledge } });
        }),
      getCategoryById: (planId: string, categoryId: string) =>
        fake.call("categories.getCategoryById", [planId, categoryId], () => {
          const plan = fake.getPlan(planId);
          const category = plan.categories.get(categoryId);
          if (!category) notFound();
          return Promise.resolve({ data: { category: materializeCategory(plan, category, firstOfMonth(fake.now)) } });
        }),
      getMonthCategoryById: (planId: string, month: string, categoryId: string) =>
        fake.call("categories.getMonthCategoryById", [planId, month, categoryId], () => {
          const plan = fake.getPlan(planId);
          const category = plan.categories.get(categoryId);
          if (!category) notFound();
          return Promise.resolve({ data: { category: materializeCategory(plan, category, normalizeMonth(month, fake.now)) } });
        }),
      updateMonthCategory: (planId: string, month: string, categoryId: string, data: ynab.PatchMonthCategoryWrapper) =>
        fake.call("categories.updateMonthCategory", [planId, month, categoryId, data], () => {
          const plan = fake.getPlan(planId);
          const category = plan.categories.get(categoryId);
          if (!category) notFound();
          const monthIso = normalizeMonth(month, fake.now);
          plan.monthlyBudgeted.set(budgetKey(monthIso, categoryId), data.category.budgeted);
          touch(plan, "category", categoryId);
          touch(plan, "month", monthIso);
          return Promise.resolve({
            data: { category: materializeCategory(plan, category, monthIso), server_knowledge: plan.serverKnowledge },
          });
        }),
      updateCategory: (planId: string, categoryId: string, data: ynab.PatchCategoryWrapper) =>
        fake.call("categories.updateCategory", [planId, categoryId, data], () => {
          const plan = fake.getPlan(planId);
          const category = plan.categories.get(categoryId);
          if (!category) notFound();
          const patch = data.category;
          if (patch.name !== undefined) category.name = patch.name;
          if (patch.note !== undefined) category.note = patch.note;
          if (patch.category_group_id !== undefined) category.category_group_id = patch.category_group_id;
          if (patch.goal_target !== undefined) category.goal_target = patch.goal_target;
          if (patch.goal_target_date !== undefined) category.goal_target_date = patch.goal_target_date;
          if (patch.goal_needs_whole_amount !== undefined) category.goal_needs_whole_amount = patch.goal_needs_whole_amount;
          touch(plan, "category", categoryId);
          return Promise.resolve({
            data: { category: materializeCategory(plan, category, firstOfMonth(fake.now)), server_knowledge: plan.serverKnowledge },
          });
        }),
      createCategory: (planId: string, data: ynab.PostCategoryWrapper) =>
        fake.call("categories.createCategory", [planId, data], () => {
          const plan = fake.getPlan(planId);
          const id = nextId("cat");
          const groupId = data.category.category_group_id ?? [...plan.categoryGroups.keys()][0] ?? "";
          const category: ynab.Category = {
            id,
            category_group_id: groupId,
            name: data.category.name ?? "New Category",
            hidden: false,
            internal: false,
            note: data.category.note,
            budgeted: 0,
            activity: 0,
            balance: 0,
            goal_target: data.category.goal_target,
            goal_target_date: data.category.goal_target_date,
            goal_needs_whole_amount: data.category.goal_needs_whole_amount,
            goal_type: data.category.goal_target ? "NEED" : undefined,
            deleted: false,
          };
          plan.categories.set(id, category);
          touch(plan, "category", id);
          return Promise.resolve({
            data: { category: materializeCategory(plan, category, firstOfMonth(fake.now)), server_knowledge: plan.serverKnowledge },
          });
        }),
      createCategoryGroup: (planId: string, data: ynab.PostCategoryGroupWrapper) =>
        fake.call("categories.createCategoryGroup", [planId, data], () => {
          const plan = fake.getPlan(planId);
          const id = nextId("catgrp");
          const group: ynab.CategoryGroup = { id, name: data.category_group.name, hidden: false, internal: false, deleted: false };
          plan.categoryGroups.set(id, group);
          touch(plan, "categoryGroup", id);
          return Promise.resolve({ data: { category_group: group, server_knowledge: plan.serverKnowledge } });
        }),
      updateCategoryGroup: (planId: string, categoryGroupId: string, data: ynab.PatchCategoryGroupWrapper) =>
        fake.call("categories.updateCategoryGroup", [planId, categoryGroupId, data], () => {
          const plan = fake.getPlan(planId);
          const group = plan.categoryGroups.get(categoryGroupId);
          if (!group) notFound();
          group.name = data.category_group.name;
          touch(plan, "categoryGroup", categoryGroupId);
          return Promise.resolve({ data: { category_group: group, server_knowledge: plan.serverKnowledge } });
        }),
    };

    const months = {
      getPlanMonths: (planId: string, lastKnowledgeOfServer?: number) =>
        fake.call("months.getPlanMonths", [planId, lastKnowledgeOfServer], () => {
          const plan = fake.getPlan(planId);
          const monthSet = new Set<string>([firstOfMonth(fake.now)]);
          for (const t of plan.transactions.values()) monthSet.add(monthOf(t.date));
          for (const key of plan.monthlyBudgeted.keys()) monthSet.add(key.split("|")[0]);
          const monthsList = [...monthSet]
            .filter((m) => changedSince(plan, "month", m, lastKnowledgeOfServer))
            .sort()
            .map((m) => materializeMonth(plan, m));
          return Promise.resolve({ data: { months: monthsList, server_knowledge: plan.serverKnowledge } });
        }),
      getPlanMonth: (planId: string, month: string) =>
        fake.call("months.getPlanMonth", [planId, month], () => {
          const plan = fake.getPlan(planId);
          return Promise.resolve({ data: { month: materializeMonth(plan, normalizeMonth(month, fake.now)) } });
        }),
    };

    const payees = {
      getPayees: (planId: string, lastKnowledgeOfServer?: number) =>
        fake.call("payees.getPayees", [planId, lastKnowledgeOfServer], () => {
          const plan = fake.getPlan(planId);
          const list = [...plan.payees.values()].filter((p) => changedSince(plan, "payee", p.id, lastKnowledgeOfServer));
          return Promise.resolve({ data: { payees: list, server_knowledge: plan.serverKnowledge } });
        }),
      getPayeeById: (planId: string, payeeId: string) =>
        fake.call("payees.getPayeeById", [planId, payeeId], () => {
          const plan = fake.getPlan(planId);
          const payee = plan.payees.get(payeeId);
          if (!payee) notFound();
          return Promise.resolve({ data: { payee } });
        }),
      createPayee: (planId: string, data: ynab.PostPayeeWrapper) =>
        fake.call("payees.createPayee", [planId, data], () => {
          const plan = fake.getPlan(planId);
          const id = nextId("payee");
          const payee: ynab.Payee = { id, name: data.payee.name, transfer_account_id: null, deleted: false };
          plan.payees.set(id, payee);
          touch(plan, "payee", id);
          return Promise.resolve({ data: { payee, server_knowledge: plan.serverKnowledge } });
        }),
      updatePayee: (planId: string, payeeId: string, data: ynab.PatchPayeeWrapper) =>
        fake.call("payees.updatePayee", [planId, payeeId, data], () => {
          const plan = fake.getPlan(planId);
          const payee = plan.payees.get(payeeId);
          if (!payee) notFound();
          if (data.payee.name !== undefined) payee.name = data.payee.name;
          touch(plan, "payee", payeeId);
          return Promise.resolve({ data: { payee, server_knowledge: plan.serverKnowledge } });
        }),
    };

    function respondTransactions(plan: PlanState, list: StoredTransaction[]): ynab.TransactionsResponse {
      return { data: { transactions: list.map((t) => materializeTransaction(plan, t)), server_knowledge: plan.serverKnowledge } };
    }

    function subtransactionRow(plan: PlanState, parent: ynab.TransactionDetail, raw: StoredSubtransaction): ynab.HybridTransaction {
      const sub = materializeSubtransaction(plan, raw);
      return {
        ...parent,
        id: sub.id,
        amount: sub.amount,
        memo: sub.memo,
        payee_id: sub.payee_id ?? undefined,
        payee_name: sub.payee_name,
        category_id: sub.category_id ?? undefined,
        category_name: sub.category_name ?? undefined,
        amount_formatted: sub.amount_formatted,
        amount_currency: sub.amount_currency,
        type: "subtransaction",
        parent_transaction_id: parent.id,
      };
    }

    function hybridRowsForCategory(plan: PlanState, categoryId: string, list: StoredTransaction[]): ynab.HybridTransaction[] {
      const rows: ynab.HybridTransaction[] = [];
      for (const t of list) {
        const materialized = materializeTransaction(plan, t);
        if (t.category_id === categoryId) {
          rows.push({ ...materialized, category_name: materialized.category_name ?? undefined, type: "transaction", parent_transaction_id: null });
        }
        for (const raw of t.subtransactions) {
          if (raw.category_id === categoryId) rows.push(subtransactionRow(plan, materialized, raw));
        }
      }
      return rows;
    }

    function hybridRowsForPayee(plan: PlanState, payeeId: string, list: StoredTransaction[]): ynab.HybridTransaction[] {
      const rows: ynab.HybridTransaction[] = [];
      for (const t of list) {
        const materialized = materializeTransaction(plan, t);
        if (t.payee_id === payeeId) {
          rows.push({ ...materialized, category_name: materialized.category_name ?? undefined, type: "transaction", parent_transaction_id: null });
        }
        for (const raw of t.subtransactions) {
          if (raw.payee_id === payeeId) rows.push(subtransactionRow(plan, materialized, raw));
        }
      }
      return rows;
    }

    const transactions = {
      getTransactions: (planId: string, sinceDate?: string, untilDate?: string, type?: TxnType, lastKnowledgeOfServer?: number) =>
        fake.call("transactions.getTransactions", [planId, sinceDate, untilDate, type, lastKnowledgeOfServer], () => {
          const plan = fake.getPlan(planId);
          const list = selectTransactions(plan, { sinceDate, untilDate, type }).filter((t) =>
            changedSince(plan, "transaction", t.id, lastKnowledgeOfServer)
          );
          return Promise.resolve(respondTransactions(plan, list));
        }),
      getTransactionsByAccount: (
        planId: string,
        accountId: string,
        sinceDate?: string,
        untilDate?: string,
        type?: TxnType,
        lastKnowledgeOfServer?: number
      ) =>
        fake.call("transactions.getTransactionsByAccount", [planId, accountId, sinceDate, untilDate, type, lastKnowledgeOfServer], () => {
          const plan = fake.getPlan(planId);
          if (!plan.accounts.has(accountId)) notFound();
          const list = selectTransactions(plan, { accountId, sinceDate, untilDate, type }).filter((t) =>
            changedSince(plan, "transaction", t.id, lastKnowledgeOfServer)
          );
          return Promise.resolve(respondTransactions(plan, list));
        }),
      getTransactionsByMonth: (
        planId: string,
        month: string,
        sinceDate?: string,
        untilDate?: string,
        type?: TxnType,
        lastKnowledgeOfServer?: number
      ) =>
        fake.call("transactions.getTransactionsByMonth", [planId, month, sinceDate, untilDate, type, lastKnowledgeOfServer], () => {
          const plan = fake.getPlan(planId);
          const list = selectTransactions(plan, { month: normalizeMonth(month, fake.now), sinceDate, untilDate, type }).filter((t) =>
            changedSince(plan, "transaction", t.id, lastKnowledgeOfServer)
          );
          return Promise.resolve(respondTransactions(plan, list));
        }),
      getTransactionsByCategory: (
        planId: string,
        categoryId: string,
        sinceDate?: string,
        untilDate?: string,
        type?: TxnType,
        lastKnowledgeOfServer?: number
      ) =>
        fake.call("transactions.getTransactionsByCategory", [planId, categoryId, sinceDate, untilDate, type, lastKnowledgeOfServer], () => {
          const plan = fake.getPlan(planId);
          if (!plan.categories.has(categoryId)) notFound();
          const list = selectTransactions(plan, { sinceDate, untilDate, type }).filter((t) =>
            changedSince(plan, "transaction", t.id, lastKnowledgeOfServer)
          );
          return Promise.resolve({
            data: { transactions: hybridRowsForCategory(plan, categoryId, list), server_knowledge: plan.serverKnowledge },
          });
        }),
      getTransactionsByPayee: (
        planId: string,
        payeeId: string,
        sinceDate?: string,
        untilDate?: string,
        type?: TxnType,
        lastKnowledgeOfServer?: number
      ) =>
        fake.call("transactions.getTransactionsByPayee", [planId, payeeId, sinceDate, untilDate, type, lastKnowledgeOfServer], () => {
          const plan = fake.getPlan(planId);
          if (!plan.payees.has(payeeId)) notFound();
          const list = selectTransactions(plan, { sinceDate, untilDate, type }).filter((t) =>
            changedSince(plan, "transaction", t.id, lastKnowledgeOfServer)
          );
          return Promise.resolve({
            data: { transactions: hybridRowsForPayee(plan, payeeId, list), server_knowledge: plan.serverKnowledge },
          });
        }),
      getTransactionById: (planId: string, transactionId: string) =>
        fake.call("transactions.getTransactionById", [planId, transactionId], () => {
          const plan = fake.getPlan(planId);
          const t = plan.transactions.get(transactionId);
          if (!t) notFound();
          return Promise.resolve({ data: { transaction: materializeTransaction(plan, t), server_knowledge: plan.serverKnowledge } });
        }),
      createTransaction: (planId: string, data: ynab.PostTransactionsWrapper) =>
        fake.call("transactions.createTransaction", [planId, data], () => {
          const plan = fake.getPlan(planId);
          return Promise.resolve(createMany(plan, data));
        }),
      createTransactions: (planId: string, data: ynab.PostTransactionsWrapper) =>
        fake.call("transactions.createTransactions", [planId, data], () => {
          const plan = fake.getPlan(planId);
          return Promise.resolve(createMany(plan, data));
        }),
      updateTransaction: (planId: string, transactionId: string, data: ynab.PutTransactionWrapper) =>
        fake.call("transactions.updateTransaction", [planId, transactionId, data], () => {
          const plan = fake.getPlan(planId);
          const t = plan.transactions.get(transactionId);
          if (!t) notFound();
          applyTransactionPatch(plan, t, data.transaction);
          touch(plan, "transaction", transactionId);
          touch(plan, "month", monthOf(t.date));
          return Promise.resolve({ data: { transaction: materializeTransaction(plan, t), server_knowledge: plan.serverKnowledge } });
        }),
      updateTransactions: (planId: string, data: ynab.PatchTransactionsWrapper) =>
        fake.call("transactions.updateTransactions", [planId, data], () => {
          const plan = fake.getPlan(planId);
          const updated: ynab.TransactionDetail[] = [];
          for (const patch of data.transactions) {
            const t = patch.id
              ? plan.transactions.get(patch.id)
              : [...plan.transactions.values()].find((existing) => existing.import_id === patch.import_id);
            if (!t) continue;
            applyTransactionPatch(plan, t, patch);
            touch(plan, "transaction", t.id);
            touch(plan, "month", monthOf(t.date));
            updated.push(materializeTransaction(plan, t));
          }
          return Promise.resolve({
            data: { transaction_ids: updated.map((t) => t.id), transactions: updated, server_knowledge: plan.serverKnowledge },
          });
        }),
      deleteTransaction: (planId: string, transactionId: string) =>
        fake.call("transactions.deleteTransaction", [planId, transactionId], () => {
          const plan = fake.getPlan(planId);
          const t = plan.transactions.get(transactionId);
          if (!t) notFound();
          t.deleted = true;
          touch(plan, "transaction", t.id);
          if (t.transfer_transaction_id) {
            const mirror = plan.transactions.get(t.transfer_transaction_id);
            if (mirror) {
              mirror.deleted = true;
              touch(plan, "transaction", mirror.id);
            }
          }
          return Promise.resolve({ data: { transaction: materializeTransaction(plan, t), server_knowledge: plan.serverKnowledge } });
        }),
      importTransactions: (planId: string) =>
        fake.call("transactions.importTransactions", [planId], () => {
          const plan = fake.getPlan(planId);
          const queued = plan.importQueue;
          plan.importQueue = [];
          const ids: string[] = [];
          for (const seed of queued) {
            const outcome = createOneTransaction(plan, seed);
            if (outcome.created) ids.push(outcome.created.id);
          }
          return Promise.resolve({ data: { transaction_ids: ids } });
        }),
    };

    function applyTransactionPatch(plan: PlanState, t: StoredTransaction, patch: ynab.ExistingTransaction | ynab.SaveTransactionWithIdOrImportId): void {
      if (patch.account_id !== undefined) t.account_id = patch.account_id;
      if (patch.date !== undefined) t.date = patch.date;
      if (patch.amount !== undefined) t.amount = patch.amount;
      if (patch.payee_id !== undefined) t.payee_id = patch.payee_id ?? undefined;
      // Like the real API, payee_name only applies when payee_id is not given: it matches an existing payee or creates one.
      if (patch.payee_id == null && patch.payee_name) t.payee_id = resolvePayee(plan, { payee_name: patch.payee_name }).payeeId;
      if (patch.category_id !== undefined) t.category_id = patch.category_id ?? undefined;
      if (patch.memo !== undefined) t.memo = patch.memo ?? undefined;
      if (patch.cleared !== undefined) t.cleared = patch.cleared;
      if (patch.approved !== undefined) t.approved = patch.approved;
      if (patch.flag_color !== undefined) t.flag_color = patch.flag_color ?? undefined;
      if (patch.subtransactions !== undefined) {
        // The real API rejects an attempt to change the lines of a transaction
        // that is already a split, but allows turning a plain transaction into
        // one by supplying subtransactions for the first time.
        if (t.subtransactions.some((s) => !s.deleted)) {
          throw ynabError("400", "bad_request", "Updating subtransactions on an existing split transaction is not supported.");
        }
        t.subtransactions = buildSubtransactions(plan, t.id, patch.subtransactions);
        t.category_id = undefined;
      }
      // Setting payee_id to an account's transfer payee creates a transfer on
      // update the same way it does on create, mirroring the new transaction
      // onto the target account. A transaction that is already a transfer is
      // left alone here: the real API's rules for editing one further (moving
      // its amount or date in step with the mirror) are not modeled.
      if (!t.transfer_transaction_id) {
        const transferTarget = t.payee_id ? plan.payees.get(t.payee_id) : undefined;
        const targetAccountId = transferTarget?.transfer_account_id;
        if (targetAccountId && targetAccountId !== t.account_id) {
          t.category_id = undefined;
          createTransferMirror(plan, t, targetAccountId);
        }
      }
    }

    function createMany(plan: PlanState, data: ynab.PostTransactionsWrapper): ynab.SaveTransactionsResponse {
      const inputs = data.transaction ? [data.transaction] : (data.transactions ?? []);
      const created: ynab.TransactionDetail[] = [];
      const duplicates: string[] = [];
      for (const input of inputs) {
        const outcome = createOneTransaction(plan, input);
        if (outcome.created) created.push(outcome.created);
        if (outcome.duplicateImportId) duplicates.push(outcome.duplicateImportId);
      }
      return {
        data: {
          transaction_ids: created.map((t) => t.id),
          transaction: data.transaction ? created[0] : undefined,
          // The real API does not return a batch in request order (observed: sorted by id).
          transactions: data.transactions ? [...created].sort((a, b) => b.id.localeCompare(a.id)) : undefined,
          duplicate_import_ids: duplicates,
          server_knowledge: plan.serverKnowledge,
        },
      };
    }

    const scheduledTransactions = {
      getScheduledTransactions: (planId: string, lastKnowledgeOfServer?: number) =>
        fake.call("scheduledTransactions.getScheduledTransactions", [planId, lastKnowledgeOfServer], () => {
          const plan = fake.getPlan(planId);
          const list = [...plan.scheduledTransactions.values()]
            .filter((s) => changedSince(plan, "scheduledTransaction", s.id, lastKnowledgeOfServer))
            .map((s) => materializeScheduled(plan, s));
          return Promise.resolve({ data: { scheduled_transactions: list, server_knowledge: plan.serverKnowledge } });
        }),
      getScheduledTransactionById: (planId: string, scheduledTransactionId: string) =>
        fake.call("scheduledTransactions.getScheduledTransactionById", [planId, scheduledTransactionId], () => {
          const plan = fake.getPlan(planId);
          const s = plan.scheduledTransactions.get(scheduledTransactionId);
          if (!s) notFound();
          return Promise.resolve({ data: { scheduled_transaction: materializeScheduled(plan, s) } });
        }),
      createScheduledTransaction: (planId: string, data: ynab.PostScheduledTransactionWrapper) =>
        fake.call("scheduledTransactions.createScheduledTransaction", [planId, data], () => {
          const plan = fake.getPlan(planId);
          const save = data.scheduled_transaction;
          const { payeeId } = resolvePayee(plan, save);
          const id = nextId("sched");
          const stored: StoredScheduledTransaction = {
            id,
            date_first: save.date,
            date_next: save.date,
            frequency: save.frequency ?? "never",
            amount: save.amount ?? 0,
            memo: save.memo ?? undefined,
            flag_color: save.flag_color ?? undefined,
            flag_name: undefined,
            account_id: save.account_id,
            payee_id: payeeId,
            category_id: save.category_id ?? undefined,
            transfer_account_id: undefined,
            deleted: false,
            subtransactions: [],
          };
          plan.scheduledTransactions.set(id, stored);
          touch(plan, "scheduledTransaction", id);
          return Promise.resolve({
            data: { scheduled_transaction: materializeScheduled(plan, stored), server_knowledge: plan.serverKnowledge },
          });
        }),
      // A real PUT: the whole scheduled transaction is replaced by `save`, so a
      // field this fake doesn't see is cleared, not preserved. Callers that
      // want to keep a field must fetch the existing one and pass it back.
      updateScheduledTransaction: (planId: string, scheduledTransactionId: string, data: ynab.PutScheduledTransactionWrapper) =>
        fake.call("scheduledTransactions.updateScheduledTransaction", [planId, scheduledTransactionId, data], () => {
          const plan = fake.getPlan(planId);
          const s = plan.scheduledTransactions.get(scheduledTransactionId);
          if (!s) notFound();
          const save = data.scheduled_transaction;
          if (!plan.accounts.has(save.account_id)) notFound();
          const { payeeId } = resolvePayee(plan, save);
          s.account_id = save.account_id;
          s.date_next = save.date;
          s.amount = save.amount ?? 0;
          s.payee_id = payeeId;
          s.category_id = save.category_id ?? undefined;
          s.memo = save.memo ?? undefined;
          s.flag_color = save.flag_color ?? undefined;
          s.frequency = save.frequency ?? "never";
          touch(plan, "scheduledTransaction", scheduledTransactionId);
          return Promise.resolve({
            data: { scheduled_transaction: materializeScheduled(plan, s), server_knowledge: plan.serverKnowledge },
          });
        }),
      deleteScheduledTransaction: (planId: string, scheduledTransactionId: string) =>
        fake.call("scheduledTransactions.deleteScheduledTransaction", [planId, scheduledTransactionId], () => {
          const plan = fake.getPlan(planId);
          const s = plan.scheduledTransactions.get(scheduledTransactionId);
          if (!s) notFound();
          s.deleted = true;
          touch(plan, "scheduledTransaction", scheduledTransactionId);
          return Promise.resolve({ data: { scheduled_transaction: materializeScheduled(plan, s) } });
        }),
    };

    const moneyMovements = {
      getMoneyMovements: (planId: string) =>
        fake.call("money_movements.getMoneyMovements", [planId], () => {
          const plan = fake.getPlan(planId);
          return Promise.resolve({ data: { money_movements: [...plan.moneyMovements.values()], server_knowledge: plan.serverKnowledge } });
        }),
      getMoneyMovementsByMonth: (planId: string, month: string) =>
        fake.call("money_movements.getMoneyMovementsByMonth", [planId, month], () => {
          const plan = fake.getPlan(planId);
          const monthIso = normalizeMonth(month, fake.now);
          const list = [...plan.moneyMovements.values()].filter((m) => m.month === monthIso);
          return Promise.resolve({ data: { money_movements: list, server_knowledge: plan.serverKnowledge } });
        }),
    };

    return {
      plans,
      accounts,
      categories,
      months,
      payees,
      transactions,
      scheduledTransactions,
      money_movements: moneyMovements,
    } as unknown as ynab.API;
  }
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

export function planFixture(overrides: Partial<PlanSeed> = {}): PlanSeed {
  return { currency_format: USD_CURRENCY, date_format: DEFAULT_DATE_FORMAT, ...overrides };
}

export function accountFixture(overrides: Partial<ynab.Account> & { name: string }): ynab.Account {
  return {
    id: nextId("acct", overrides.id),
    type: "checking",
    on_budget: true,
    closed: false,
    balance: 0,
    cleared_balance: 0,
    uncleared_balance: 0,
    transfer_payee_id: "",
    deleted: false,
    ...overrides,
  };
}

export function categoryGroupFixture(overrides: Partial<ynab.CategoryGroup> & { name: string }): ynab.CategoryGroup {
  return { id: nextId("catgrp", overrides.id), hidden: false, internal: false, deleted: false, ...overrides };
}

export function categoryFixture(
  overrides: Partial<ynab.Category> & { category_group_id: string } & { budgetedByMonth?: Record<string, number> }
): ynab.Category & { budgetedByMonth?: Record<string, number> } {
  return {
    id: nextId("cat", overrides.id),
    name: "Category",
    hidden: false,
    internal: false,
    budgeted: 0,
    activity: 0,
    balance: 0,
    deleted: false,
    ...overrides,
  };
}

export function payeeFixture(overrides: Partial<ynab.Payee> & { name: string }): ynab.Payee {
  return { id: nextId("payee", overrides.id), transfer_account_id: null, deleted: false, ...overrides };
}

export function transactionFixture(overrides: Partial<TransactionSeed> & { account_id: string }): TransactionSeed {
  return {
    date: "2024-01-15",
    amount: -10000,
    cleared: "cleared",
    approved: true,
    ...overrides,
  };
}

export function scheduledTransactionFixture(
  overrides: Partial<StoredScheduledTransaction> & { account_id: string; date_first: string }
): StoredScheduledTransaction {
  return {
    id: nextId("sched", overrides.id),
    date_next: overrides.date_first,
    frequency: "monthly",
    amount: -10000,
    deleted: false,
    subtransactions: [],
    ...overrides,
  };
}

export function moneyMovementFixture(overrides: Partial<ynab.MoneyMovement> & { month: string; amount: number }): ynab.MoneyMovement {
  return { id: nextId("mvmt", overrides.id), deleted: false, ...overrides } as ynab.MoneyMovement;
}

/**
 * A ready-made scenario: a USD plan with a checking account, a credit card,
 * two category groups (one with a hidden and a deleted category), a few
 * payees, and ten transactions across two months covering the cases the
 * fake's own tests exercise: unapproved, uncategorized, a split and a
 * transfer.
 */
export function standardPlan() {
  const checking = accountFixture({ name: "Checking" });
  const creditCard = accountFixture({ name: "Credit Card", type: "creditCard" });

  const everydayGroup = categoryGroupFixture({ name: "Everyday Expenses" });
  const savingsGroup = categoryGroupFixture({ name: "Savings Goals" });

  const groceries = categoryFixture({ category_group_id: everydayGroup.id, name: "Groceries", budgeted: 50000 });
  const dining = categoryFixture({ category_group_id: everydayGroup.id, name: "Dining Out", budgeted: 20000 });
  const oldHobby = categoryFixture({ category_group_id: everydayGroup.id, name: "Old Hobby", hidden: true });
  const closedProject = categoryFixture({ category_group_id: savingsGroup.id, name: "Closed Project", deleted: true });
  const vacation = categoryFixture({ category_group_id: savingsGroup.id, name: "Vacation", budgeted: 100000 });

  const grocer = payeeFixture({ name: "Corner Grocer" });
  const cafe = payeeFixture({ name: "Downtown Cafe" });
  const employer = payeeFixture({ name: "Employer" });

  const transactions: TransactionSeed[] = [
    transactionFixture({ account_id: checking.id, date: "2024-01-03", amount: 200000, payee_id: employer.id, approved: true }),
    transactionFixture({ account_id: checking.id, date: "2024-01-05", amount: -6000, payee_id: grocer.id, category_id: groceries.id }),
    transactionFixture({
      account_id: checking.id,
      date: "2024-01-10",
      amount: -4500,
      payee_id: cafe.id,
      category_id: dining.id,
      approved: false,
    }),
    transactionFixture({ account_id: checking.id, date: "2024-01-12", amount: -3000, payee_name: "Unknown Kiosk" }),
    transactionFixture({
      account_id: checking.id,
      date: "2024-01-20",
      amount: -12000,
      payee_id: grocer.id,
      subtransactions: [
        { amount: -8000, category_id: groceries.id },
        { amount: -4000, category_id: dining.id },
      ],
    }),
    transactionFixture({ account_id: checking.id, date: "2024-01-25", amount: -50000, transfer_to_account_id: creditCard.id }),
    transactionFixture({ account_id: checking.id, date: "2024-02-01", amount: -5500, payee_id: grocer.id, category_id: groceries.id }),
    transactionFixture({ account_id: checking.id, date: "2024-02-02", amount: -2000, payee_id: cafe.id, category_id: dining.id }),
    transactionFixture({ account_id: creditCard.id, date: "2024-02-05", amount: -9000, payee_id: cafe.id, category_id: dining.id }),
    transactionFixture({ account_id: checking.id, date: "2024-02-10", amount: 10000, payee_id: employer.id }),
  ];
  return {
    seed: {
      accounts: [checking, creditCard],
      categoryGroups: [everydayGroup, savingsGroup],
      categories: [groceries, dining, oldHobby, closedProject, vacation],
      payees: [grocer, cafe, employer],
      transactions,
    } satisfies PlanSeed,
    accounts: { checking, creditCard },
    categories: { groceries, dining, oldHobby, closedProject, vacation },
    payees: { grocer, cafe, employer },
    transactions,
  };
}
