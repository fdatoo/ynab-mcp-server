# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-27

### Changed (breaking)
- Tools consolidated and renamed. `ynab_get_transactions` and `ynab_get_unapproved_transactions` become `ynab_search_transactions`; `ynab_create_transaction` becomes `ynab_create_transactions`; `ynab_update_transaction` becomes `ynab_update_transactions`; `ynab_approve_transaction` and `ynab_bulk_approve_transactions` become `ynab_approve_transactions`; `ynab_update_category_budget` becomes `ynab_assign`; `ynab_list_budgets` becomes `ynab_list_plans`.
- Amounts are in the plan's currency. Inputs are positive with a required `direction`; outputs are signed numbers.
- Tool parameters say `planId`. `YNAB_PLAN_ID` is the new default-plan variable; `YNAB_BUDGET_ID` still works. Without either, YNAB's last-used plan is used.
- The server exits at startup when `YNAB_API_TOKEN` is missing.

### Fixed
- Creating a transaction with a positive amount recorded an inflow.
- `limit` on transaction listing kept the oldest transactions.
- Errors were returned as ordinary results; they now set `isError`.
- The budget summary returned the raw month in milliunits without the analysis it described.
- Categories in YNAB's default groups (Bills, Needs, Wants) were hidden.
- A repeated create request made a duplicate transaction.

### Added
- Splits, transfers, batch create and update, reconciliation, spending report.
- Category and category group create and update, move money, money movement history.
- Account and payee create, payee rename, scheduled transaction create, update and delete.
- Names accepted wherever an account, category or payee id is.
- Server instructions listing what the YNAB API cannot do.
- Rate-limit tracking, one retry for failed reads, and a cache for accounts, categories and payees.

## [0.1.2] - 2024-03-26

### Added
- New `ApproveTransaction` tool for approving existing transactions in YNAB
  - Can approve/unapprove transactions by ID
  - Works in conjunction with GetUnapprovedTransactions tool
  - Preserves existing transaction data when updating approval status
- Added Cursor rules for YNAB API development
  - New `.cursor/rules/ynabapi.mdc` file
  - Provides guidance for working with YNAB types and API endpoints
  - Helps maintain consistency in tool development

### Changed
- Updated project structure documentation to include `.cursor/rules` directory
- Enhanced README with documentation for the new ApproveTransaction tool 