import type * as ynab from "ynab";

/**
 * Payees YNAB creates for its own balance entries. They have no marker field,
 * so they are recognised by exact name. Their transactions are neither
 * spending nor income, and are never worth categorising.
 */
export const BALANCE_PAYEES: ReadonlySet<string> = new Set([
  "Starting Balance",
  "Manual Balance Adjustment",
  "Reconciliation Balance Adjustment",
]);

export function isBalanceEntry(payeeName: string | null | undefined): boolean {
  return !!payeeName && BALANCE_PAYEES.has(payeeName);
}

/**
 * A transfer between the user's own accounts. The API also returns these for
 * type=uncategorized (verified live), so callers filter them out themselves.
 * The payee check covers a transaction whose payee is a transfer payee before
 * YNAB has linked the other side.
 */
export function isTransfer(
  txn: Pick<ynab.TransactionDetail, "transfer_account_id" | "payee_id">,
  transferPayeeIds?: ReadonlySet<string>
): boolean {
  return !!txn.transfer_account_id || (!!txn.payee_id && !!transferPayeeIds?.has(txn.payee_id));
}

/**
 * A credit card payment category. The API accepts one on a transaction but
 * silently stores the transaction as Uncategorized (verified live), so tools
 * that categorise transactions must refuse these. Assigning money to them is
 * normal. There is no field linking the category to its card, so the group
 * name is the signal.
 */
export function isCreditCardPaymentCategory(category: { category_group_name?: string | null }): boolean {
  return category.category_group_name === "Credit Card Payments";
}
