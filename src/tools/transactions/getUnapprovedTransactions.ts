import * as ynab from "ynab";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const getUnapprovedTransactions = defineTool({
  name: "ynab_get_unapproved_transactions",
  title: "Get Unapproved Transactions",
  description:
    "Gets unapproved transactions from a plan. First time pulls last 3 days, subsequent pulls use server knowledge to get only changes.",
  inputSchema: { planId: planIdParam },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const response = await ctx.api.transactions.getTransactions(
      ctx.planId(input.planId),
      undefined,
      undefined,
      ynab.GetTransactionsTypeEnum.Unapproved
    );
    const transactions = response.data.transactions
      .filter((txn) => !txn.deleted)
      .map((txn) => ({
        id: txn.id,
        date: txn.date,
        amount: (txn.amount / 1000).toFixed(2),
        memo: txn.memo,
        approved: txn.approved,
        account_name: txn.account_name,
        payee_name: txn.payee_name,
        category_name: txn.category_name,
        transfer_account_id: txn.transfer_account_id,
        transfer_transaction_id: txn.transfer_transaction_id,
        matched_transaction_id: txn.matched_transaction_id,
        import_id: txn.import_id,
      }));
    return { transactions, transaction_count: transactions.length };
  },
});
