# ynab-mcp-server

An MCP server that lets an AI assistant read and manage your [YNAB](https://ynab.com) plan: log and categorize spending, approve imports, assign and move money, reconcile accounts, manage categories and recurring transactions, and report on where the money went.

This is a fork of [calebl/ynab-mcp-server](https://github.com/calebl/ynab-mcp-server), reworked so an assistant can do nearly everything the YNAB API allows without falling back to the YNAB website. Compared with upstream:

- It covers about twice as much of the API: splits, transfers, batch create and update, reconciliation, recurring transactions, category and group management, moving money, auto-assign, category suggestions from your own history, and a spending report.
- Amounts are in your plan's currency, and every write states its direction, so a purchase cannot be recorded as income by a sign mistake.
- Accounts, categories and payees can be named instead of looked up by id.
- Errors reach the assistant as errors, repeated create requests don't duplicate transactions, and the assistant is told which things only the YNAB app can do.
- Tests run against an in-memory fake of the YNAB API, and a script exercises every write tool against a real sandbox plan.

Tool names differ from upstream (see [CHANGELOG.md](CHANGELOG.md)), so the two are not drop-in replacements for each other.

## Setup

1. Create a Personal Access Token at https://app.ynab.com/settings/developer. It does not expire, so you set it once. The token stays in the server's environment and is never sent to the model.
2. Clone and build:
   ```bash
   git clone https://github.com/fdatoo/ynab-mcp-server.git
   cd ynab-mcp-server
   npm install   # also builds, via the prepare script
   ```
   Build output is not committed, so run `npm run build` again after pulling changes.
3. Add it to your client. For Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%/Claude/claude_desktop_config.json` on Windows):
   ```json
   {
     "mcpServers": {
       "ynab": {
         "command": "node",
         "args": ["/absolute/path/to/ynab-mcp-server/dist/index.js"],
         "env": {
           "YNAB_API_TOKEN": "your-token",
           "YNAB_PLAN_ID": "optional-default-plan-id"
         }
       }
     }
   }
   ```
   For Claude Code: `claude mcp add ynab -e YNAB_API_TOKEN=your-token -- node /absolute/path/to/ynab-mcp-server/dist/index.js`

### Environment

| Variable | Required | Meaning |
|---|---|---|
| `YNAB_API_TOKEN` | yes | Personal Access Token. The server exits at startup without it. |
| `YNAB_PLAN_ID` | no | Default plan. `YNAB_BUDGET_ID` is still accepted. Without either, YNAB's most recently used plan is used. |

YNAB renamed budgets to "plans" in its API; the tools use the API's name.

## How amounts work

Amounts are in your plan's currency, not YNAB's internal milliunits. When the assistant creates or changes a transaction, it gives a positive amount and a separate direction, `outflow` (spending) or `inflow` (income, refunds), so a purchase can never be recorded as income by a sign mistake. Amounts in results are signed: negative is money leaving an account.

Accounts, categories and payees can be named rather than given by id. Names match ignoring case, emoji and punctuation, so "groceries" finds "🛒 Groceries". A category name used in two groups can be written `Group: Name`. An ambiguous or unknown name returns the candidates instead of a guess.

## Tools

Transactions
- `ynab_search_transactions`: newest first, filtered by dates, account, category, payee, unapproved or uncategorized, text, amount range, direction and cleared status. Searches the last 90 days unless told otherwise.
- `ynab_get_transaction`
- `ynab_create_transactions`: one or many, including splits and transfers. A repeated request is recognized (same account, date and amount) and not created twice unless the user confirms it is separate.
- `ynab_update_transactions`: partial updates to one or many; can turn a transaction into a split. `ifUncategorized` skips a transaction that was categorized in the meantime.
- `ynab_approve_transactions`: by id or everything unapproved matching a filter, with a dry run.
- `ynab_suggest_categories`: proposes categories for uncategorized transactions from each payee's history. Nothing leaves your machine except the usual YNAB request.
- `ynab_delete_transaction`
- `ynab_import_transactions`: pulls pending transactions from linked banks.
- `ynab_reconcile_account`: compares a statement balance with the cleared balance and reconciles, previewing first.

Plan and categories
- `ynab_budget_summary`: Ready to Assign, overspent categories, underfunded goals, top spending.
- `ynab_list_categories`, `ynab_get_category`
- `ynab_assign`, `ynab_move_money`, `ynab_list_money_movements`
- `ynab_auto_assign`: fills underfunded goals from Ready to Assign, largest shortfall first, previewing first.
- `ynab_create_category`, `ynab_update_category`, `ynab_create_category_group`, `ynab_update_category_group`
- `ynab_list_months`, `ynab_spending_report`

Accounts, payees, recurring
- `ynab_list_plans`, `ynab_list_accounts` (flags accounts whose bank connection needs fixing), `ynab_create_account`
- `ynab_list_payees`, `ynab_create_payee`, `ynab_rename_payee`
- `ynab_list_scheduled_transactions`, `ynab_create_scheduled_transaction`, `ynab_update_scheduled_transaction`, `ynab_delete_scheduled_transaction`

### What the YNAB API cannot do

These have to be done in the YNAB app. The server tells the assistant so, which keeps it from trying to work around them:

- delete or merge categories, category groups, payees or accounts
- hide or unhide categories
- close, reopen or link accounts, or fix a bank connection
- edit the lines of an existing split (a plain transaction can be turned into a split)
- scheduled split transactions
- match an imported transaction to a manual one by hand
- undo
- change plan settings such as currency

## Rate limit

YNAB allows 200 requests per hour per token. The server caches accounts, categories and payees for a minute and refreshes them with delta requests, retries a failed read once, and reports a clear message if the limit is reached.

## Development

```bash
npm run build        # compile to dist/
npm run typecheck    # sources and tests
npm test             # vitest, against an in-memory fake of the YNAB API
npm run debug        # MCP inspector
```

`CLAUDE.md` describes the architecture and how to add a tool. Two scripts check the built server against the real API:

- `node scripts/smoke.mjs [tool '{"json":"args"}' ...]` calls tools with your `YNAB_API_TOKEN`. Use read-only tools unless pointed at a test plan.
- `YNAB_SANDBOX_PLAN_ID=... node scripts/sandbox-check.mjs` runs every write tool against a plan whose name contains "Sandbox" and cleans up after itself. Categories, groups and payees it creates are reused across runs, since the API cannot delete them.

## Upstream

To pull in changes from the original project:

```bash
git remote add upstream https://github.com/calebl/ynab-mcp-server.git   # once
git fetch upstream
git merge upstream/main
```
