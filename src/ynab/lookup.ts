import type * as ynab from "ynab";

/** How long cached accounts, categories and payees are reused without asking YNAB. */
export const CACHE_TTL_MS = 60_000;

interface Entry<T> {
  items: Map<string, T>;
  serverKnowledge: number;
  fetchedAt: number;
  stale: boolean;
}

type Kind = "accounts" | "categories" | "payees";

export interface LookupOptions {
  now?: () => number;
  ttlMs?: number;
}

export type CategoryWithGroup = ynab.Category & { category_group_name: string };

/**
 * Per-plan cache of accounts, categories and payees, used to turn names into
 * ids. The first read fetches everything; later reads within the TTL are free,
 * and after it a delta request (last_knowledge_of_server) fetches only changes.
 * Writes made through this server call invalidate() so the next read refreshes.
 *
 * Entries are keyed by the plan id string as given, so "last-used" is cached
 * separately from the id it resolves to.
 */
export class Lookup {
  private readonly entries = new Map<string, Entry<unknown>>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(
    private readonly api: ynab.API,
    options: LookupOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? CACHE_TTL_MS;
  }

  invalidate(planId: string, kinds: Kind[] = ["accounts", "categories", "payees"]): void {
    for (const kind of kinds) {
      const entry = this.entries.get(`${planId}:${kind}`);
      if (entry) entry.stale = true;
    }
  }

  async accounts(planId: string, options: { refresh?: boolean } = {}): Promise<ynab.Account[]> {
    const items = await this.load<ynab.Account>(planId, "accounts", options.refresh, async (knowledge) => {
      const { data } = await this.api.accounts.getAccounts(planId, knowledge);
      return { items: data.accounts, serverKnowledge: data.server_knowledge };
    });
    return items.filter((account) => !account.deleted);
  }

  async categories(planId: string, options: { refresh?: boolean } = {}): Promise<CategoryWithGroup[]> {
    const items = await this.load<CategoryWithGroup>(planId, "categories", options.refresh, async (knowledge) => {
      const { data } = await this.api.categories.getCategories(planId, knowledge);
      // A delta response only carries the groups and categories that changed.
      const items = data.category_groups.flatMap((group) =>
        group.categories.map((category) => ({
          ...category,
          category_group_name: group.name,
          deleted: category.deleted || group.deleted,
        }))
      );
      return { items, serverKnowledge: data.server_knowledge };
    });
    return items.filter((category) => !category.deleted);
  }

  async payees(planId: string, options: { refresh?: boolean } = {}): Promise<ynab.Payee[]> {
    const items = await this.load<ynab.Payee>(planId, "payees", options.refresh, async (knowledge) => {
      const { data } = await this.api.payees.getPayees(planId, knowledge);
      return { items: data.payees, serverKnowledge: data.server_knowledge };
    });
    return items.filter((payee) => !payee.deleted);
  }

  async resolveAccount(planId: string, ref: string): Promise<ynab.Account> {
    return this.resolve(ref, "account", (refresh) => this.accounts(planId, { refresh }), (account) => [account.name], (account) => account.closed);
  }

  /** Accepts an id, a name, or "Group: Name" to pick between same-named categories. */
  async resolveCategory(planId: string, ref: string): Promise<CategoryWithGroup> {
    return this.resolve(
      ref,
      "category",
      (refresh) => this.categories(planId, { refresh }),
      (category) => [category.name, `${category.category_group_name}: ${category.name}`],
      (category) => category.hidden
    );
  }

  async resolvePayee(planId: string, ref: string): Promise<ynab.Payee> {
    return this.resolve(ref, "payee", (refresh) => this.payees(planId, { refresh }), (payee) => [payee.name], () => false);
  }

  private async load<T extends { id: string }>(
    planId: string,
    kind: Kind,
    refresh: boolean | undefined,
    fetch: (lastKnowledge?: number) => Promise<{ items: T[]; serverKnowledge: number }>
  ): Promise<T[]> {
    const key = `${planId}:${kind}`;
    const entry = this.entries.get(key) as Entry<T> | undefined;
    const fresh = entry && !entry.stale && !refresh && this.now() - entry.fetchedAt < this.ttlMs;
    if (fresh) return [...entry.items.values()];

    const result = await fetch(entry?.serverKnowledge);
    const items = entry ? entry.items : new Map<string, T>();
    for (const item of result.items) items.set(item.id, item);
    this.entries.set(key, { items, serverKnowledge: result.serverKnowledge, fetchedAt: this.now(), stale: false });
    return [...items.values()];
  }

  private async resolve<T extends { id: string }>(
    ref: string,
    noun: string,
    list: (refresh: boolean) => Promise<T[]>,
    names: (item: T) => string[],
    isInactive: (item: T) => boolean
  ): Promise<T> {
    const attempt = (items: T[]) => match(ref, items, names, isInactive);
    let result = attempt(await list(false));
    // A miss may mean the cache predates a change made in the YNAB app.
    if (result.kind === "none") result = attempt(await list(true));

    if (result.kind === "one") return result.item;
    if (result.kind === "many") {
      const options = result.items.slice(0, 10).map((item) => `${names(item).at(-1)} (${item.id})`);
      throw new Error(`"${ref}" matches more than one ${noun}: ${options.join("; ")}. Use the id or a more specific name.`);
    }
    const suggestions = result.near.slice(0, 5).map((item) => names(item).at(-1));
    throw new Error(
      `No ${noun} matches "${ref}".` + (suggestions.length ? ` Did you mean: ${suggestions.join(", ")}?` : "")
    );
  }
}

/** Lowercase, and drop emoji, punctuation and extra spaces: "🛒 Groceries!" and "groceries" compare equal. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}:]+/gu, " ")
    .replace(/\s*:\s*/g, ": ")
    .trim();
}

type MatchResult<T> = { kind: "one"; item: T } | { kind: "many"; items: T[] } | { kind: "none"; near: T[] };

function match<T extends { id: string }>(
  ref: string,
  items: T[],
  names: (item: T) => string[],
  isInactive: (item: T) => boolean
): MatchResult<T> {
  const byId = items.find((item) => item.id === ref);
  if (byId) return { kind: "one", item: byId };

  const pick = (candidates: T[]): MatchResult<T> | undefined => {
    if (candidates.length === 1) return { kind: "one", item: candidates[0] };
    if (candidates.length > 1) {
      // Prefer an open account or visible category over a closed or hidden namesake.
      const active = candidates.filter((item) => !isInactive(item));
      if (active.length === 1) return { kind: "one", item: active[0] };
      return { kind: "many", items: candidates };
    }
    return undefined;
  };

  const exact = pick(items.filter((item) => names(item).some((name) => name.trim().toLowerCase() === ref.trim().toLowerCase())));
  if (exact) return exact;

  const wanted = normalizeName(ref);
  if (!wanted) return { kind: "none", near: [] };
  const normalized = pick(items.filter((item) => names(item).some((name) => normalizeName(name) === wanted)));
  if (normalized) return normalized;

  const near = items.filter((item) => names(item).some((name) => normalizeName(name).includes(wanted)));
  return { kind: "none", near };
}
