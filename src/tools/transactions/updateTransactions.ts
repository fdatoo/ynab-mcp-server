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
import { payeeFields, splitLine, transactionCategoryId } from "./shared.js";
import { toMilliunits, type Currency } from "../../ynab/money.js";

const update = z.strictObject({
  id: z.string().describe("Id of the transaction to update"),
  account: accountRef.optional().describe("Move the transaction to a different account"),
  date: dateParam.optional(),
  amount: amountParam.optional().describe("New amount; must be given together with direction"),
  direction: directionParam.optional().describe("Must be given together with amount"),
  payee: payeeRef
    .optional()
    .describe("Payee name or id. A name with no existing payee creates one; the result lists new payees. Not with transferToAccount."),
  transferToAccount: accountRef.optional().describe("Make this a transfer to or from this account instead of setting a payee"),
  category: categoryRef.nullable().optional().describe("Category id or name; null clears it"),
  memo: z.string().max(500).nullable().optional().describe("null clears the memo"),
  cleared: clearedParam.optional(),
  approved: z.boolean().optional(),
  flagColor: flagColorParam.nullable().optional().describe("null clears the flag"),
  splits: z
    .array(splitLine)
    .min(2)
    .optional()
    .describe(
      "Turns a plain transaction into a split. Lines, with their directions, must add up to the transaction's amount " +
        "(the new amount if given, else its current one). The API cannot edit an existing split's lines: recreate it instead."
    ),
  ifUncategorized: z
    .boolean()
    .optional()
    .describe("Only apply this update if the transaction is still uncategorized; skip it, without writing, if it was categorized, split or deleted meanwhile."),
});

type UpdateInput = z.infer<typeof update>;

interface Prepared {
  index: number;
  body: ynab.SaveTransactionWithIdOrImportId;
  newPayees: string[];
}

async function prepare(
  ctx: ToolContext,
  planId: string,
  currency: Currency,
  input: UpdateInput,
  index: number,
  existing: ynab.TransactionDetail | undefined
): Promise<Prepared> {
  const where = `transactions[${index}] (${input.id})`;
  if ((input.amount !== undefined) !== (input.direction !== undefined)) {
    throw new Error(`${where}: amount and direction must be given together`);
  }
  if (input.payee && input.transferToAccount) throw new Error(`${where}: give either payee or transferToAccount, not both`);
  if (input.splits && input.category !== undefined) throw new Error(`${where}: a split transaction takes categories on its lines, not on the transaction`);

  const account = input.account ? await ctx.lookup.resolveAccount(planId, input.account) : undefined;
  const amount = input.amount !== undefined ? signedMilliunits(toMilliunits(input.amount, currency), input.direction!) : undefined;
  const newPayees: string[] = [];

  let payee: Partial<ynab.SaveTransactionWithIdOrImportId> = {};
  if (input.transferToAccount) {
    const target = await ctx.lookup.resolveAccount(planId, input.transferToAccount);
    if (account && target.id === account.id) throw new Error(`${where}: cannot transfer an account to itself`);
    payee = { payee_id: target.transfer_payee_id };
  } else if (input.payee) {
    payee = await payeeFields(ctx, planId, input.payee, newPayees);
  }

  let subtransactions: ynab.SaveSubTransaction[] | undefined;
  if (input.splits) {
    if (existing?.subtransactions?.some((sub) => !sub.deleted)) {
      throw new Error(
        `${where}: this transaction is already a split. YNAB's API cannot edit an existing split's lines; delete it and recreate it with the new splits instead.`
      );
    }
    const target = amount ?? existing?.amount ?? 0;
    const fallbackDirection = target < 0 ? "outflow" : "inflow";
    subtransactions = [];
    for (const line of input.splits) {
      subtransactions.push({
        amount: signedMilliunits(toMilliunits(line.amount, currency), line.direction ?? input.direction ?? fallbackDirection),
        category_id: line.category ? await transactionCategoryId(ctx, planId, line.category) : undefined,
        ...(line.payee ? await payeeFields(ctx, planId, line.payee, newPayees) : {}),
        memo: line.memo,
      });
    }
    const total = subtransactions.reduce((sum, line) => sum + line.amount, 0);
    if (total !== target) {
      throw new Error(`${where}: split lines add up to ${total / 1000}, but the transaction amount is ${target / 1000}`);
    }
  }

  // category_id and memo are typed as plain strings in the SDK, but the API
  // accepts null on both to clear them; the cast below reflects that gap.
  const categoryId = input.category === null ? null : input.category !== undefined ? await transactionCategoryId(ctx, planId, input.category) : undefined;

  return {
    index,
    newPayees,
    body: {
      id: input.id,
      account_id: account?.id,
      date: input.date,
      amount,
      ...payee,
      category_id: categoryId,
      memo: input.memo,
      cleared: input.cleared as ynab.TransactionClearedStatus | undefined,
      approved: input.approved,
      flag_color: input.flagColor as ynab.TransactionFlagColor | null | undefined,
      subtransactions,
    } as unknown as ynab.SaveTransactionWithIdOrImportId,
  };
}

export const updateTransactions = defineTool({
  name: "ynab_update_transactions",
  title: "Update Transactions",
  description:
    "Updates one or more existing transactions by id. Only the fields given are changed; leave a field out to keep it. " +
    "Amount changes need a direction, just like creating a transaction. category, memo and flagColor accept null to clear them. " +
    "Splits can be added to a plain transaction, but an existing split's lines cannot be edited through this tool: " +
    "delete and recreate that transaction instead. Set ifUncategorized on an item to guard against a stale read: " +
    "if it was categorized, split or deleted since you looked it up, that item is skipped rather than overwritten.",
  inputSchema: {
    planId: planIdParam,
    transactions: z.array(update).min(1).max(100),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async handler(input, ctx) {
    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);

    // A guarded item is only applied if it is still uncategorized on the
    // server. This is the one extra read the guard costs, and only when at
    // least one item asks for it.
    const guardedIds = input.transactions.some((item) => item.ifUncategorized)
      ? new Set((await ctx.api.transactions.getTransactions(planId, undefined, undefined, "uncategorized")).data.transactions.map((txn) => txn.id))
      : undefined;

    const skippedChanged: Array<{ id: string; reason: string }> = [];
    const toApply: Array<{ item: UpdateInput; index: number }> = [];
    for (const [index, item] of input.transactions.entries()) {
      if (item.ifUncategorized && !guardedIds!.has(item.id)) {
        skippedChanged.push({ id: item.id, reason: "no longer uncategorized: it may have been categorized, split, or deleted since it was read" });
        continue;
      }
      toApply.push({ item, index });
    }

    // Splits can't be added to a transaction that is already one, so fetch
    // whichever items need that check before building the patch bodies.
    const existingById = new Map<string, ynab.TransactionDetail>();
    for (const { item } of toApply) {
      if (item.splits && !existingById.has(item.id)) {
        const { data } = await ctx.api.transactions.getTransactionById(planId, item.id);
        existingById.set(item.id, data.transaction);
      }
    }

    const prepared: Prepared[] = [];
    for (const { item, index } of toApply) {
      prepared.push(await prepare(ctx, planId, currency, item, index, existingById.get(item.id)));
    }

    // If the guard skipped everything, there is nothing left to write.
    const updated = prepared.length
      ? ((await ctx.api.transactions.updateTransactions(planId, { transactions: prepared.map((p) => p.body) })).data.transactions ?? [])
      : [];
    const updatedIds = new Set(updated.map((txn) => txn.id));
    const notUpdated = toApply.map(({ item }) => item.id).filter((id) => !updatedIds.has(id));

    const newPayees = [...new Set(prepared.flatMap((p) => p.newPayees))];
    if (newPayees.length > 0) ctx.lookup.invalidate(planId, ["payees"]);

    return {
      currency: currency.iso_code,
      updated: updated.map((txn) => formatTransaction(txn, currency)),
      ...(notUpdated.length > 0 ? { not_updated: notUpdated } : {}),
      ...(newPayees.length > 0 ? { new_payees: newPayees } : {}),
      ...(skippedChanged.length > 0 ? { skipped_changed: skippedChanged } : {}),
    };
  },
});
