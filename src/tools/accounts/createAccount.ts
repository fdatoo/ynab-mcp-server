import { z } from "zod";
import * as ynab from "ynab";
import { defineTool } from "../defineTool.js";
import { amountParam, directionParam, planIdParam, signedMilliunits } from "../common.js";
import { fromMilliunits, toMilliunits } from "../../ynab/money.js";

const accountTypeParam = z
  .enum(["checking", "savings", "cash", "creditCard", "otherAsset", "otherLiability"])
  .describe("Account type");

export const createAccount = defineTool({
  name: "ynab_create_account",
  title: "Create Account",
  description:
    "Creates an account in the plan. The account is unlinked: it has no bank connection, and the API cannot close, reopen, or " +
    "delete it, or link one to a bank. Do those in the YNAB app. Starting balance is a positive amount plus direction: for a " +
    "credit card or loan, an amount already owed is an outflow.",
  inputSchema: {
    planId: planIdParam,
    name: z.string().min(1),
    type: accountTypeParam,
    startingBalance: amountParam.optional().describe("Starting balance, if the account isn't starting from zero"),
    direction: directionParam.optional().describe("Required together with startingBalance"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async handler(input, ctx) {
    if ((input.startingBalance !== undefined) !== (input.direction !== undefined)) {
      throw new Error("startingBalance and direction must be given together");
    }

    const planId = ctx.planId(input.planId);
    const currency = await ctx.currency(planId);
    const balance =
      input.startingBalance !== undefined ? signedMilliunits(toMilliunits(input.startingBalance, currency), input.direction!) : 0;

    const { data } = await ctx.api.accounts.createAccount(planId, {
      account: { name: input.name, type: input.type as ynab.SaveAccountType, balance },
    });
    ctx.lookup.invalidate(planId, ["accounts", "payees"]);

    const account = data.account;
    return {
      currency: currency.iso_code,
      account: {
        id: account.id,
        name: account.name,
        type: account.type,
        on_budget: account.on_budget,
        balance: fromMilliunits(account.balance, currency),
      },
    };
  },
});
