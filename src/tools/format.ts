import type * as ynab from "ynab";
import { fromMilliunits, type Currency } from "../ynab/money.js";

/**
 * The transaction shape every tool returns. Amounts are signed numbers in the
 * plan's currency: negative is an outflow, positive an inflow.
 */
export function formatTransaction(txn: ynab.TransactionDetail, currency: Currency) {
  return {
    id: txn.id,
    date: txn.date,
    amount: fromMilliunits(txn.amount, currency),
    payee: txn.payee_name ?? null,
    category: txn.subtransactions?.length ? "Split" : (txn.category_name ?? null),
    account: txn.account_name,
    memo: txn.memo ?? null,
    cleared: txn.cleared,
    approved: txn.approved,
    flag_color: txn.flag_color ?? null,
    ...(txn.transfer_account_id ? { transfer_account_id: txn.transfer_account_id } : {}),
    ...(txn.subtransactions?.length
      ? {
          subtransactions: txn.subtransactions
            .filter((sub) => !sub.deleted)
            .map((sub) => ({
              amount: fromMilliunits(sub.amount, currency),
              category: sub.category_name ?? null,
              payee: sub.payee_name ?? null,
              memo: sub.memo ?? null,
            })),
        }
      : {}),
  };
}

/** Rows from the by-category endpoint, where a split's matching line appears on its own. */
export function formatHybridTransaction(txn: ynab.HybridTransaction, currency: Currency) {
  return {
    id: txn.type === "subtransaction" ? (txn.parent_transaction_id ?? txn.id) : txn.id,
    ...(txn.type === "subtransaction" ? { split_line: true } : {}),
    date: txn.date,
    amount: fromMilliunits(txn.amount, currency),
    payee: txn.payee_name ?? null,
    category: txn.category_name ?? null,
    account: txn.account_name,
    memo: txn.memo ?? null,
    cleared: txn.cleared,
    approved: txn.approved,
    flag_color: txn.flag_color ?? null,
    ...(txn.transfer_account_id ? { transfer_account_id: txn.transfer_account_id } : {}),
  };
}
