import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const listScheduledTransactions = defineTool({
  name: "ynab_list_scheduled_transactions",
  title: "List Scheduled Transactions",
  description: "Lists all scheduled (recurring) transactions in a plan.",
  inputSchema: { planId: planIdParam },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const response = await ctx.api.scheduledTransactions.getScheduledTransactions(ctx.planId(input.planId));
    const scheduledTransactions = response.data.scheduled_transactions
      .filter((txn) => !txn.deleted)
      .map((txn) => ({
        id: txn.id,
        date_first: txn.date_first,
        date_next: txn.date_next,
        frequency: txn.frequency,
        amount: (txn.amount / 1000).toFixed(2),
        memo: txn.memo,
        flag_color: txn.flag_color,
        account_id: txn.account_id,
        account_name: txn.account_name,
        payee_id: txn.payee_id,
        payee_name: txn.payee_name,
        category_id: txn.category_id,
        category_name: txn.category_name,
        transfer_account_id: txn.transfer_account_id,
      }));
    return { scheduled_transactions: scheduledTransactions, count: scheduledTransactions.length };
  },
});
