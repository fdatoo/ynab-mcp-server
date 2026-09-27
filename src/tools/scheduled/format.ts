import type * as ynab from "ynab";
import { fromMilliunits, type Currency } from "../../ynab/money.js";

/**
 * The scheduled-transaction shape every tool in this domain returns. Amount is
 * a signed number in the plan's currency: negative is an outflow.
 */
export function formatScheduledTransaction(txn: ynab.ScheduledTransactionDetail, currency: Currency) {
  return {
    id: txn.id,
    date_first: txn.date_first,
    date_next: txn.date_next,
    frequency: txn.frequency,
    amount: fromMilliunits(txn.amount, currency),
    account: txn.account_name,
    payee: txn.payee_name ?? null,
    category: txn.category_name ?? null,
    memo: txn.memo ?? null,
    flag_color: txn.flag_color ?? null,
    ...(txn.transfer_account_id ? { transfer_account_id: txn.transfer_account_id } : {}),
  };
}
