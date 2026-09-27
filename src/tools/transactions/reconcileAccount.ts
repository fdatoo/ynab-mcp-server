import { z } from "zod";
import * as ynab from "ynab";
import { defineTool } from "../defineTool.js";
import { accountRef, dateParam, planIdParam } from "../common.js";
import { formatTransaction } from "../format.js";
import { fromMilliunits, toMilliunits } from "../../ynab/money.js";

const ADJUSTMENT_PAYEE = "Reconciliation Balance Adjustment";
const READY_TO_ASSIGN = "Inflow: Ready to Assign";

export const reconcileAccount = defineTool({
  name: "ynab_reconcile_account",
  title: "Reconcile Account",
  description:
    "Reconciles an account against a bank or card statement, the way YNAB's Reconcile button does. Compares the statement balance with " +
    "the cleared balance (cleared and reconciled transactions, up to statementDate if given). Previews by default; with apply=true " +
    "and a matching balance it marks those cleared transactions reconciled. On a mismatch it lists uncleared transactions that " +
    "would explain the difference, and only with createAdjustment=true (and apply=true) adds a balance adjustment transaction. " +
    "Balances are signed: money owed on a credit card is negative.",
  inputSchema: {
    planId: planIdParam,
    account: accountRef,
    statementBalance: z.number().describe("Balance on the statement, signed (a credit card balance owed is negative)"),
    statementDate: dateParam.optional().describe("Statement closing date; later transactions are left out. Defaults to including everything."),
    apply: z.boolean().default(false).describe("Make the changes. Without this the tool only reports what it would do."),
    createAdjustment: z.boolean().default(false).describe("On a mismatch, add an adjustment transaction for the difference"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const account = await ctx.lookup.resolveAccount(planId, input.account);
    const { data } = await ctx.api.transactions.getTransactionsByAccount(planId, account.id);

    const upTo = (txn: ynab.TransactionDetail) => !input.statementDate || txn.date <= input.statementDate;
    const live = (data.transactions as ynab.TransactionDetail[]).filter((txn) => !txn.deleted && upTo(txn));
    const isCleared = (txn: ynab.TransactionDetail) => txn.cleared !== ynab.TransactionClearedStatus.Uncleared;
    const clearedBalance = live.filter(isCleared).reduce((sum, txn) => sum + txn.amount, 0);
    const statement = toMilliunits(input.statementBalance, currency);
    const difference = statement - clearedBalance;
    const toReconcile = live.filter((txn) => txn.cleared === ynab.TransactionClearedStatus.Cleared);
    const money = (ms: number) => fromMilliunits(ms, currency);

    const summary = {
      currency: currency.iso_code,
      account: account.name,
      statement_balance: money(statement),
      cleared_balance: money(clearedBalance),
      difference: money(difference),
      transactions_to_reconcile: toReconcile.length,
    };

    if (difference !== 0 && !input.createAdjustment) {
      // An uncleared transaction for exactly the difference is the usual culprit.
      const uncleared = live.filter((txn) => !isCleared(txn));
      const explains = uncleared.filter((txn) => txn.amount === difference);
      return {
        ...summary,
        balanced: false,
        applied: false,
        uncleared_up_to_date: uncleared.length,
        ...(explains.length ? { likely_explanation: explains.map((txn) => formatTransaction(txn, currency)) } : {}),
        next_step:
          "The balances differ. Check uncleared or missing transactions (mark cleared ones with ynab_update_transactions) and run this again, " +
          "or rerun with createAdjustment and apply if the user accepts an adjustment.",
      };
    }

    if (!input.apply) {
      return {
        ...summary,
        balanced: difference === 0,
        applied: false,
        ...(difference !== 0 ? { would_create_adjustment: money(difference) } : {}),
        next_step: "Preview only. Rerun with apply=true to make these changes.",
      };
    }

    let adjustment: ynab.TransactionDetail | undefined;
    if (difference !== 0) {
      const readyToAssign = await ctx.lookup.resolveCategory(planId, READY_TO_ASSIGN);
      const created = await ctx.api.transactions.createTransaction(planId, {
        transaction: {
          account_id: account.id,
          date: input.statementDate ?? new Date().toISOString().slice(0, 10),
          amount: difference,
          payee_name: ADJUSTMENT_PAYEE,
          category_id: account.on_budget ? readyToAssign.id : undefined,
          cleared: ynab.TransactionClearedStatus.Reconciled,
          approved: true,
          memo: "Entered automatically by reconciliation",
        },
      });
      adjustment = created.data.transaction;
    }

    if (toReconcile.length > 0) {
      await ctx.api.transactions.updateTransactions(planId, {
        transactions: toReconcile.map((txn) => ({ id: txn.id, cleared: ynab.TransactionClearedStatus.Reconciled })),
      });
    }
    ctx.lookup.invalidate(planId, ["accounts", "payees"]);

    return {
      ...summary,
      balanced: true,
      applied: true,
      reconciled: toReconcile.length,
      ...(adjustment ? { adjustment: formatTransaction(adjustment, currency) } : {}),
    };
  },
});
