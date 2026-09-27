import { z } from "zod";
import * as ynab from "ynab";
import { defineTool, type ToolContext } from "../defineTool.js";
import {
  accountRef,
  amountParam,
  categoryRef,
  clearedParam,
  dateParam,
  directionParam,
  flagColorParam,
  payeeRef,
  planIdParam,
  signedMilliunits,
} from "../common.js";
import { formatTransaction } from "../format.js";
import { payeeFields, splitLine } from "./shared.js";
import { toMilliunits, type Currency } from "../../ynab/money.js";

const newTransaction = z.object({
  account: accountRef,
  date: dateParam.describe("Transaction date (YYYY-MM-DD). Future dates are not allowed; use a scheduled transaction."),
  amount: amountParam,
  direction: directionParam,
  payee: payeeRef
    .optional()
    .describe("Payee name or id. A name with no existing payee creates one; the result lists new payees."),
  transferToAccount: accountRef.optional().describe("Make this a transfer to or from this account instead of setting a payee"),
  category: categoryRef.optional().describe("Leave out for a transfer between budget accounts, or when using splits"),
  memo: z.string().max(500).optional(),
  cleared: clearedParam.default("uncleared"),
  approved: z.boolean().default(true),
  flagColor: flagColorParam.optional(),
  splits: z
    .array(splitLine)
    .min(2)
    .optional()
    .describe("Split across categories. Line amounts, with their directions, must add up to the transaction amount."),
});

type NewTransactionInput = z.infer<typeof newTransaction>;

interface Prepared {
  index: number;
  body: ynab.NewTransaction;
  newPayees: string[];
}

async function prepare(ctx: ToolContext, planId: string, currency: Currency, input: NewTransactionInput, index: number): Promise<Prepared> {
  const where = `transactions[${index}]`;
  if (input.payee && input.transferToAccount) throw new Error(`${where}: give either payee or transferToAccount, not both`);
  if (input.splits && input.category) throw new Error(`${where}: a split transaction takes categories on its lines, not on the transaction`);

  const account = await ctx.lookup.resolveAccount(planId, input.account);
  const amount = signedMilliunits(toMilliunits(input.amount, currency), input.direction);
  const newPayees: string[] = [];

  let payee: Partial<ynab.NewTransaction> = {};
  if (input.transferToAccount) {
    const target = await ctx.lookup.resolveAccount(planId, input.transferToAccount);
    if (target.id === account.id) throw new Error(`${where}: cannot transfer an account to itself`);
    payee = { payee_id: target.transfer_payee_id };
  } else if (input.payee) {
    payee = await payeeFields(ctx, planId, input.payee, newPayees);
  }

  let subtransactions: ynab.SaveSubTransaction[] | undefined;
  if (input.splits) {
    subtransactions = [];
    for (const line of input.splits) {
      subtransactions.push({
        amount: signedMilliunits(toMilliunits(line.amount, currency), line.direction ?? input.direction),
        category_id: line.category ? (await ctx.lookup.resolveCategory(planId, line.category)).id : undefined,
        ...(line.payee ? await payeeFields(ctx, planId, line.payee, newPayees) : {}),
        memo: line.memo,
      });
    }
    const total = subtransactions.reduce((sum, line) => sum + line.amount, 0);
    if (total !== amount) {
      throw new Error(`${where}: split lines add up to ${total / 1000}, but the transaction amount is ${amount / 1000}`);
    }
  }

  return {
    index,
    newPayees,
    body: {
      account_id: account.id,
      date: input.date,
      amount,
      ...payee,
      category_id: input.category ? (await ctx.lookup.resolveCategory(planId, input.category)).id : undefined,
      memo: input.memo,
      cleared: input.cleared as ynab.TransactionClearedStatus,
      approved: input.approved,
      flag_color: input.flagColor as ynab.TransactionFlagColor | undefined,
      subtransactions,
    },
  };
}

/**
 * A repeated tool call must not create the same transaction twice, so anything
 * matching a live transaction on account, date and amount is held back.
 * One request per account involved.
 */
async function findDuplicates(ctx: ToolContext, planId: string, prepared: Prepared[]) {
  const byAccount = new Map<string, Prepared[]>();
  for (const p of prepared) byAccount.set(p.body.account_id!, [...(byAccount.get(p.body.account_id!) ?? []), p]);
  const duplicates = new Map<number, ynab.TransactionDetail>();
  for (const [accountId, items] of byAccount) {
    const since = items.map((p) => p.body.date!).sort()[0];
    const { data } = await ctx.api.transactions.getTransactionsByAccount(planId, accountId, since);
    const existing = data.transactions.filter((txn) => !txn.deleted);
    for (const item of items) {
      const match = existing.find((txn) => txn.date === item.body.date && txn.amount === item.body.amount);
      if (match) duplicates.set(item.index, match as ynab.TransactionDetail);
    }
  }
  return duplicates;
}

/**
 * The API returns a batch in its own order (by id, in practice), so each
 * created transaction is matched back to the request item it came from.
 */
function inRequestOrder(requested: Prepared[], created: ynab.TransactionDetail[]) {
  const unmatched = [...created];
  const ordered: Array<{ index: number; txn: ynab.TransactionDetail }> = [];
  for (const item of requested) {
    const at = unmatched.findIndex(
      (txn) =>
        txn.account_id === item.body.account_id &&
        txn.date === item.body.date &&
        txn.amount === item.body.amount &&
        (txn.subtransactions?.length ?? 0) === (item.body.subtransactions?.length ?? 0)
    );
    if (at >= 0) ordered.push({ index: item.index, txn: unmatched.splice(at, 1)[0] });
  }
  // Anything the match missed is still reported rather than dropped.
  for (const txn of unmatched) ordered.push({ index: -1, txn });
  return ordered;
}

export const createTransactions = defineTool({
  name: "ynab_create_transactions",
  title: "Create Transactions",
  description:
    "Creates one or more transactions; each result carries the index of the request item it came from. Every amount is positive with a required direction: 'outflow' for spending, 'inflow' for income or refunds. " +
    "Accounts, categories and payees can be given by name. Supports splits across categories and transfers between accounts. " +
    "If a transaction with the same account, date and amount already exists it is not created again and is returned under skipped_duplicates; " +
    "set allowDuplicate only when the user confirms it is a separate transaction.",
  inputSchema: {
    planId: planIdParam,
    transactions: z.array(newTransaction).min(1).max(100),
    allowDuplicate: z.boolean().default(false).describe("Create even when a matching transaction already exists"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);

    const prepared: Prepared[] = [];
    for (const [index, txn] of input.transactions.entries()) prepared.push(await prepare(ctx, planId, currency, txn, index));

    const duplicates = input.allowDuplicate ? new Map<number, ynab.TransactionDetail>() : await findDuplicates(ctx, planId, prepared);
    const toCreate = prepared.filter((p) => !duplicates.has(p.index));

    let created: Array<{ index: number; txn: ynab.TransactionDetail }> = [];
    if (toCreate.length > 0) {
      const { data } = await ctx.api.transactions.createTransaction(planId, { transactions: toCreate.map((p) => p.body) });
      created = inRequestOrder(toCreate, data.transactions ?? []);
      ctx.lookup.invalidate(planId, ["accounts", "payees"]);
    }

    const newPayees = [...new Set(toCreate.flatMap((p) => p.newPayees))];
    return {
      currency: currency.iso_code,
      created: created.map(({ index, txn }) => ({ index, ...formatTransaction(txn, currency) })),
      ...(duplicates.size > 0
        ? {
            skipped_duplicates: [...duplicates].map(([index, existing]) => ({
              index,
              existing: formatTransaction(existing, currency),
            })),
            note: "Skipped transactions matching an existing one on account, date and amount. Retry with allowDuplicate only if the user confirms they are separate.",
          }
        : {}),
      ...(newPayees.length > 0 ? { new_payees: newPayees } : {}),
    };
  },
});
