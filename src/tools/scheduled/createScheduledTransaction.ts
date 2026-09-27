import { z } from "zod";
import * as ynab from "ynab";
import { defineTool } from "../defineTool.js";
import { accountRef, amountParam, categoryRef, dateParam, directionParam, flagColorParam, payeeRef, planIdParam, signedMilliunits } from "../common.js";
import { formatScheduledTransaction } from "./format.js";
import { frequencyParam, requireFutureDate, resolveScheduledPayee } from "./shared.js";
import { toMilliunits } from "../../ynab/money.js";

export const createScheduledTransaction = defineTool({
  name: "ynab_create_scheduled_transaction",
  title: "Create Scheduled Transaction",
  description:
    "Schedules a future transaction, one-off or repeating. The date is the first occurrence and must be in the future. " +
    "Amount is positive with a required direction: 'outflow' for spending, 'inflow' for income. " +
    "Accounts, categories and payees can be given by name. Give either payee or transferToAccount, not both. " +
    "Scheduled transactions cannot have splits.",
  inputSchema: {
    planId: planIdParam,
    account: accountRef,
    date: dateParam.describe("First occurrence (YYYY-MM-DD). Must be in the future."),
    frequency: frequencyParam,
    amount: amountParam,
    direction: directionParam,
    payee: payeeRef.optional().describe("Payee name or id. A name with no existing payee creates one; the result lists new payees."),
    transferToAccount: accountRef.optional().describe("Make this a transfer to or from this account instead of setting a payee"),
    category: categoryRef.optional().describe("Leave out for a transfer between budget accounts"),
    memo: z.string().max(500).optional(),
    flagColor: flagColorParam.optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async handler(input, ctx) {
    if (input.payee && input.transferToAccount) throw new Error("give either payee or transferToAccount, not both");
    requireFutureDate(input.date);

    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const account = await ctx.lookup.resolveAccount(planId, input.account);
    const amount = signedMilliunits(toMilliunits(input.amount, currency), input.direction);

    const newPayees: string[] = [];
    let payeeFields: { payee_id?: string | null; payee_name?: string } = {};
    if (input.transferToAccount) {
      const target = await ctx.lookup.resolveAccount(planId, input.transferToAccount);
      if (target.id === account.id) throw new Error("cannot transfer an account to itself");
      payeeFields = { payee_id: target.transfer_payee_id };
    } else if (input.payee) {
      payeeFields = await resolveScheduledPayee(ctx, planId, input.payee, newPayees);
    }

    const { data } = await ctx.api.scheduledTransactions.createScheduledTransaction(planId, {
      scheduled_transaction: {
        account_id: account.id,
        date: input.date,
        amount,
        ...payeeFields,
        category_id: input.category ? (await ctx.lookup.resolveCategory(planId, input.category)).id : undefined,
        memo: input.memo,
        flag_color: input.flagColor as ynab.TransactionFlagColor | undefined,
        frequency: input.frequency as ynab.ScheduledTransactionFrequency,
      },
    });
    if (newPayees.length > 0) ctx.lookup.invalidate(planId, ["payees"]);

    return {
      currency: currency.iso_code,
      scheduled_transaction: formatScheduledTransaction(data.scheduled_transaction, currency),
      ...(newPayees.length > 0 ? { new_payees: newPayees } : {}),
    };
  },
});
