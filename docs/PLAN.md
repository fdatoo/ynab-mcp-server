# Overhaul plan

Status: proposed, 2026-09-27.

This plan covers the audit findings in three phases: restructure and clean up, fix the known bugs, then cover the rest of the YNAB API. Each phase leaves `main` working and shippable. Phase 1 changes no user-visible behaviour beyond tool naming; phase 2 changes behaviour only where it was wrong.

The motivating problem: when the agent is asked to do something this server cannot do (split a transaction, add a category, set up a recurring bill), it falls back to driving app.ynab.com in a browser, and that session keeps expiring. The fix is coverage, plus telling the agent plainly what the API cannot do so it says so instead of reaching for the browser.

## Decisions to confirm before starting

These are recommendations. Each is cheap to flip now and expensive to flip later.

1. Transaction direction. Replace the bare signed `amount` with `amount` (always positive) plus a required `direction: "outflow" | "inflow"` on every tool that writes an amount. A required field forces the model to state intent; a sign convention it has to remember is how expenses got logged as income.
2. Terminology. Adopt the API's "plan" naming in tool names and parameters (`planId`, `ynab_list_plans`). Keep `YNAB_BUDGET_ID` as a fallback for `YNAB_PLAN_ID` so existing configs keep working.
3. Tool names change. The tool set is consolidated (see the catalogue below), so some names disappear. The only consumers are your two local client configs, so no compatibility shims.
4. Untrack `dist/`. Build output goes in `.gitignore`; `npm install` builds via `prepare`, and CI checks the build. Your clients still point at `dist/index.js`, so after pulling you run `npm run build` (the README says so).
5. Amounts in and out use the plan's currency, read from plan settings, not hard-coded dollars.

## Phase 1: restructure and clean up

Goal: one place for each cross-cutting concern, so phase 2 fixes land once instead of sixteen times.

### 1.1 Dependencies and tooling

- Remove `axios`, `@types/axios`, `commander` (never imported). This clears the axios, follow-redirects and form-data audit findings.
- Upgrade `@modelcontextprotocol/sdk` 1.18 → 1.30.x (clears its advisories; gives tool annotations and `structuredContent`).
- Upgrade `ynab` 2.10 → 4.5.x. Migration hazard: `getTransactions*` gained a positional `untilDate` before `type`. Every call site moves to the new signature in the same commit, and a test pins the argument order.
- Upgrade `zod` 3 → 4 (the MCP SDK accepts `^3.25 || ^4.0`). Do this as its own commit so a schema regression is easy to bisect.
- Set `engines.node` to `>=20` and match `.tool-versions`.
- Delete `debugging/` (two raw-fetch scripts superseded by the inspector) and `.vscode/launch.json` if unused.
- Run `npm audit` after the upgrades and record anything left with a reason.

### 1.2 Target layout

```
src/
  index.ts              startup: env check, build context, register tools, connect
  server.ts             createServer(ctx): McpServer, loops over the registry
  config.ts             env parsing (token required, plan id optional), fails fast
  ynab/
    client.ts           wraps ynab.API: plan id resolution, error normalization,
                        retry/backoff on 429 and 5xx, request counting
    cache.ts            per-plan delta cache (server_knowledge) for accounts,
                        categories, payees
    resolve.ts          name → id resolution with ambiguity errors
    money.ts            currency-aware milliunit conversion and formatting
  tools/
    defineTool.ts       helper: schema, annotations, handler → registered tool
    registry.ts         the list of all tools
    plans/  accounts/  categories/  payees/  transactions/  scheduled/  reports/
  tests/
    fakes/ynab.ts       in-memory fake of the endpoints we use, with realistic
                        ordering and sign conventions
```

### 1.3 The tool contract

`defineTool` replaces the per-file boilerplate:

- Input type comes from `z.infer` on the schema; the hand-written interfaces go.
- The handler receives `{ input, ctx }` where `ctx` holds the client, the resolved plan id, the cache and money helpers. No handler reads `process.env`.
- The handler returns plain data. `defineTool` serializes it as compact JSON in `content` (no `structuredContent`, which would put every result in the model's context twice), and turns any thrown error into `isError: true` with a normalized message. This fixes the "errors look like successes" bug structurally.
- Each tool declares MCP annotations: `readOnlyHint` for reads, `destructiveHint` for delete and bulk operations, `idempotentHint` where true. Clients use these to decide when to confirm.

`index.ts` shrinks to building the context and looping over `registry.ts`.

### 1.4 Client wrapper

- Plan id resolution in one place: explicit argument, then `YNAB_PLAN_ID`, then `YNAB_BUDGET_ID`, then `"last-used"` (which the API accepts). The fifteen copies of `getBudgetId` go.
- Error normalization: YNAB error bodies, network errors and HTTP status mapped to one shape (`status`, `id`, `detail`). A 401 says the token is invalid or revoked and names the env var; a 429 says the hourly limit is hit.
- Rate limiting: YNAB allows 200 requests per hour per token. Honour 429 with bounded backoff (at most one retry, since the window is an hour), and track the count so tools can warn before hitting the wall.
- Missing token fails at startup with a clear message instead of a 401 later.

### 1.5 Delta cache

Accounts, categories and payees change rarely and are needed constantly for name resolution. Cache them per plan with the `server_knowledge` value, refresh with `last_knowledge_of_server` (returns only changes), and invalidate after any write. This cuts request volume sharply, which matters at 200 per hour.

### 1.6 CI and repo hygiene

- Workflow runs on push to `main` and on PRs.
- Add `npm run typecheck` (`tsc --noEmit`) and run it before tests.
- Fix or remove the coverage upload (it is gated on Node 20, which is not in the matrix, so it never runs).
- Single source for the version: read it from `package.json` at startup instead of hard-coding `0.1.2` in `index.ts`.
- Delete stale remote branches after checking nothing on them is wanted (`add-knowledge-store`, `http-streaming-server`, `claude/add-http-server-hosting-*`, `claude/transaction-approval-ui-*`, `yarn-upgrade`, `update-readme`, `minor-version-bump`, `prefix-tool-names`).

### 1.7 Tests

Replace per-test ad hoc mocks with the shared fake in `tests/fakes/ynab.ts`. The fake returns transactions oldest first and treats positive amounts as inflows, the same as the real API, so tests can catch ordering and sign bugs. Existing tests are ported, not discarded.

Add an opt-in live smoke test (`YNAB_LIVE_TEST=1`) that runs read-only tools against the real API, to catch SDK or API drift the fake cannot.

Phase 1 exit: all existing tools work through the new structure, typecheck and tests pass, `npm audit --omit=dev` is clean or every leftover finding is recorded with a reason.

## Phase 2: bug fixes

Each fix lands with a test that fails before it.

| Bug | Fix |
|---|---|
| Create treats positive amounts as inflows while the description implies dollars spent | `direction` field (decision 1), applied to create, update, split lines and scheduled transactions |
| `limit` returns the oldest transactions | Sort newest first by default (`sort: "newest" \| "oldest"`), add `offset`, report `total_matching` |
| Unbounded history download with no `sinceDate` | Default `sinceDate` to 90 days ago when no bound is given; state the applied window in the response |
| No `untilDate` | Pass through (SDK 4 supports it) |
| Errors returned as normal content | Handled by `defineTool` (1.3) |
| Unapproved-transactions description promises delta sync it doesn't do | Tool folded into search (see catalogue); descriptions audited against behaviour |
| Budget summary filters categories then returns the unfiltered month, in milliunits, without the promised analysis | Rewrite: Ready to Assign, overspent categories, underfunded goals, top activity, all in currency units, hidden and deleted categories excluded |
| No retry protection on create, so a repeated call duplicates | Before creating, look for a live transaction in the same account with the same date and amount; if one exists, return it instead unless `allowDuplicate: true`. Setting `import_id` was the first idea, but YNAB treats such transactions as imported and will not match them to the bank's later import, which would cause the very duplicates it was meant to prevent |
| Approve fetches the transaction before updating | Single `updateTransactions` call |
| Create can't set `reconciled`; `flagColor` unvalidated | Shared enums for cleared status and flag colour across all tools |
| Update can't clear memo, category or flag | Accept explicit `null` to clear |
| Hard-coded `$` and `/1000` | `money.ts` using plan settings (`decimal_digits`, symbol) and the API's `amount_currency` fields |
| `ListCategories` reports `hidden` after filtering hidden out | Add `includeHidden`; the field then means something |
| `UpdateCategoryBudget` month accepts any day | Accept `YYYY-MM` or `current`, normalize to the first of the month |

## Phase 3: feature coverage

### Tool catalogue after phase 3

Consolidated so the agent picks from about 30 well-described tools rather than many overlapping ones. Everything that takes an id also accepts a name, resolved through `resolve.ts`; an ambiguous name returns the candidates instead of guessing.

Plans and settings
- `ynab_list_plans`: plans with currency format.
- `ynab_get_plan_settings`: currency and date format.

Accounts
- `ynab_list_accounts` (existing, now currency-aware)
- `ynab_get_account`
- `ynab_create_account`: unlinked accounts only (API limit).

Categories and assigning money
- `ynab_list_categories`: optional month, `includeHidden`.
- `ynab_get_category`: month detail including goal progress.
- `ynab_create_category`, `ynab_update_category` (name, note, group, goal target and date; the API cannot hide categories)
- `ynab_create_category_group`, `ynab_update_category_group`
- `ynab_assign`: set or adjust (`mode: "set" | "add"`) a category's assigned amount for a month.
- `ynab_move_money`: from one category (or Ready to Assign) to another. Two PATCH calls; if the second fails the first is reverted and the response says so. Not atomic, and documented as such.
- `ynab_list_money_movements`: history of moves, by month.

Payees
- `ynab_list_payees`: with name search.
- `ynab_create_payee`, `ynab_rename_payee`

Transactions
- `ynab_search_transactions`: replaces get, get-unapproved and filtered listing. Filters: since/until, account, category, payee, type (unapproved, uncategorized), memo or payee text, amount range, cleared status. Sort, limit, offset.
- `ynab_get_transaction`: includes subtransactions.
- `ynab_create_transactions`: batch, with the duplicate guard from phase 2; each item may be a split (subtransactions summing to the total, validated before sending) or a transfer (`transferToAccount` resolves the transfer payee id so the model never needs to know that trick).
- `ynab_update_transactions`: batch partial updates, including converting a transaction into a split. The API rejects edits to an existing split's lines, so the tool says so instead of attempting it.
- `ynab_approve_transactions`: ids, or a filter such as "all unapproved in account X"; `dryRun` returns what would change.
- `ynab_delete_transaction`: destructive annotation.
- `ynab_import_transactions` (existing)
- `ynab_reconcile_account`: given a statement balance and date, compares against cleared balance; on match marks cleared transactions reconciled; on mismatch reports the difference and, only with `createAdjustment: true`, adds an adjustment transaction. `dryRun` supported.

Scheduled transactions
- `ynab_list_scheduled_transactions` (existing), `ynab_create_scheduled_transaction`, `ynab_update_scheduled_transaction`, `ynab_delete_scheduled_transaction`. The API has no scheduled splits.

Months and reports
- `ynab_budget_summary`: rewritten (phase 2).
- `ynab_list_months` (existing, currency-aware)
- `ynab_spending_report`: totals by category, category group or payee over a date range, computed from transactions, with split lines attributed to their own categories.

### Server instructions: what the API cannot do

Set the MCP server `instructions` field (and repeat in relevant tool descriptions) with the operations the YNAB API does not support, so the agent tells you rather than opening a browser:

- deleting or merging categories, category groups, payees or accounts
- hiding or unhiding categories
- editing the lines of an existing split (converting a plain transaction into a split works)
- scheduled split transactions
- closing or reopening accounts, linking bank connections, fixing broken connections
- matching an imported transaction to a manual one by hand
- undo
- plan-level settings changes

Verify this list against the spec at implementation time; the API has been adding endpoints.

### Explicitly out of scope

- Payee locations (read-only, low value).
- HTTP/remote transport and OAuth. Local stdio with a PAT is the setup that doesn't expire; the abandoned HTTP branches are deleted in 1.6.

## Sequencing

Suggested commit series, each green on its own:

1. Remove unused deps; add typecheck to CI; fix CI triggers and coverage gate.
2. Untrack `dist/`.
3. Upgrade MCP SDK and `ynab` (with positional-arg migration and pinning test).
4. Upgrade zod.
5. `config.ts`, `ynab/client.ts`, `defineTool`, registry; migrate all tools; delete duplicated helpers.
6. Shared fake API; port tests.
7. `money.ts` and plan settings.
8. Cache and name resolution.
9. Phase 2 fixes, one commit per row of the table.
10. Phase 3 features, one commit per tool group (categories, payees, transactions, scheduled, reports, reconcile), then server instructions.
11. README rewrite: setup, tool catalogue, the API-limits list, the rebuild step.

In phase 3, reconciliation and splits are the largest pieces.
