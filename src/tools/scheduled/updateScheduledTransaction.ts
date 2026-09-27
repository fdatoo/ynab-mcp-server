import { z } from "zod";
import * as ynab from "ynab";
import { defineTool } from "../defineTool.js";
import { accountRef, amountParam, categoryRef, dateParam, directionParam, flagColorParam, payeeRef, planIdParam, signedMilliunits } from "../common.js";
import { formatScheduledTransaction } from "./format.js";
import { frequencyParam, requireFutureDate, resolveScheduledPayee } from "./shared.js";
import { toMilliunits } from "../../ynab/money.js";

export const updateScheduledTransaction = defineTool({
  name: "ynab_update_scheduled_transaction",
  title: "Update Scheduled Transaction",
  description:
    "Updates a scheduled transaction, given by id. Only given fields change; the rest keep their current value. " +
    "Amount and direction must be given together. Give either payee or transferToAccount, not both. " +
    "The API replaces the whole scheduled transaction, so this reads the existing one first and fills in anything not given.",
  inputSchema: {
    planId: planIdParam,
    scheduledTransactionId: z.string().describe("The scheduled transaction's id"),
    account: accountRef.optional(),
    date: dateParam.optional().describe("Next occurrence (YYYY-MM-DD). Must be in the future."),
    frequency: frequencyParam.optional(),
    amount: amountParam.optional(),
    direction: directionParam.optional().describe("Required together with amount"),
    payee: payeeRef.optional().describe("Payee name or id. A name with no existing payee creates one."),
    transferToAccount: accountRef.optional().describe("Make this a transfer to or from this account instead of setting a payee"),
    category: categoryRef.optional(),
    memo: z.string().max(500).optional(),
    flagColor: flagColorParam.optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async handler(input, ctx) {
    if ((input.amount !== undefined) !== (input.direction !== undefined)) throw new Error("amount and direction must be given together");
    if (input.payee && input.transferToAccount) throw new Error("give either payee or transferToAccount, not both");
    if (input.date) requireFutureDate(input.date);

    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const { data: existingData } = await ctx.api.scheduledTransactions.getScheduledTransactionById(planId, input.scheduledTransactionId);
    const existing = existingData.scheduled_transaction;

    const account = input.account ? await ctx.lookup.resolveAccount(planId, input.account) : undefined;
    const accountId = account?.id ?? existing.account_id;

    const newPayees: string[] = [];
    let payeeFields: { payee_id?: string | null; payee_name?: string } | undefined;
    if (input.transferToAccount) {
      const target = await ctx.lookup.resolveAccount(planId, input.transferToAccount);
      if (target.id === accountId) throw new Error("cannot transfer an account to itself");
      payeeFields = { payee_id: target.transfer_payee_id };
    } else if (input.payee) {
      payeeFields = await resolveScheduledPayee(ctx, planId, input.payee, newPayees);
    }

    const { data } = await ctx.api.scheduledTransactions.updateScheduledTransaction(planId, input.scheduledTransactionId, {
      scheduled_transaction: {
        account_id: accountId,
        date: input.date ?? existing.date_next,
        amount: input.amount !== undefined ? signedMilliunits(toMilliunits(input.amount, currency), input.direction!) : existing.amount,
        payee_id: payeeFields ? payeeFields.payee_id : existing.payee_id ?? null,
        payee_name: payeeFields?.payee_name,
        category_id: input.category ? (await ctx.lookup.resolveCategory(planId, input.category)).id : existing.category_id ?? null,
        memo: input.memo ?? existing.memo ?? null,
        flag_color: (input.flagColor as ynab.TransactionFlagColor | undefined) ?? (existing.flag_color as ynab.TransactionFlagColor | null | undefined),
        frequency: (input.frequency as ynab.ScheduledTransactionFrequency | undefined) ?? (existing.frequency as ynab.ScheduledTransactionFrequency),
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
