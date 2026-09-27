import { defineTool } from "../defineTool.js";
import { accountRef, planIdParam } from "../common.js";
import { formatScheduledTransaction } from "./format.js";

export const listScheduledTransactions = defineTool({
  name: "ynab_list_scheduled_transactions",
  title: "List Scheduled Transactions",
  description: "Lists scheduled (recurring) transactions, soonest next occurrence first. Amounts are signed: negative is an outflow.",
  inputSchema: {
    planId: planIdParam,
    account: accountRef.optional().describe("Only scheduled transactions on this account"),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const account = input.account ? await ctx.lookup.resolveAccount(planId, input.account) : undefined;

    const response = await ctx.api.scheduledTransactions.getScheduledTransactions(planId);
    const scheduled = response.data.scheduled_transactions
      .filter((txn) => !txn.deleted && (!account || txn.account_id === account.id))
      .sort((a, b) => (a.date_next < b.date_next ? -1 : a.date_next > b.date_next ? 1 : 0))
      .map((txn) => formatScheduledTransaction(txn, currency));

    return { currency: currency.iso_code, scheduled_transactions: scheduled, count: scheduled.length };
  },
});
