// Exercises the write tools end to end against a real YNAB plan, through the
// built server, and cleans up what it can. Categories, groups and payees cannot
// be deleted through the API, so those use fixed names and are reused.
//
// Usage: YNAB_API_TOKEN=... YNAB_SANDBOX_PLAN_ID=... node scripts/sandbox-check.mjs
// Refuses to run unless the plan's name contains "Sandbox".
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const planId = process.env.YNAB_SANDBOX_PLAN_ID;
if (!planId) throw new Error("Set YNAB_SANDBOX_PLAN_ID");

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env, YNAB_PLAN_ID: planId, YNAB_BUDGET_ID: "" },
  stderr: "ignore",
});
const client = new Client({ name: "sandbox-check", version: "0" });
await client.connect(transport);

async function call(name, args = {}, { expectError = false } = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? "";
  if (expectError) {
    assert.equal(result.isError, true, `${name} should have failed: ${text}`);
    return text;
  }
  assert.ok(!result.isError, `${name} failed: ${text}`);
  return JSON.parse(text);
}

const results = [];
async function step(label, fn) {
  try {
    await fn();
    results.push(["ok", label]);
  } catch (error) {
    results.push(["FAIL", label, error.message]);
  }
}

const plans = await call("ynab_list_plans");
const plan = plans.plans.find((p) => p.id === planId);
if (!plan || !/sandbox/i.test(plan.name)) throw new Error(`Refusing: plan ${planId} is not named as a sandbox`);

const today = new Date().toISOString().slice(0, 10);
const cents = (Date.now() % 9000) / 100 + 10; // a distinct amount per run, so earlier runs don't look like duplicates
const amount = Math.round(cents * 100) / 100;
const created = [];
const createdScheduled = [];

const accounts = (await call("ynab_list_accounts")).accounts;
const checking = accounts.find((a) => a.type === "checking" && a.on_budget);
const card = accounts.find((a) => a.type === "creditCard");
assert.ok(checking && card, "sandbox needs an on-budget checking account and a credit card");

// Categories and a group, reused across runs.
let groupName = "MCP Check Group";
await step("create category group (or reuse)", async () => {
  const cats = await call("ynab_list_categories", { includeHidden: true });
  if (!cats.category_groups.some((g) => g.name === groupName)) await call("ynab_create_category_group", { name: groupName });
  for (const name of ["MCP Check A", "MCP Check B"]) {
    const again = await call("ynab_list_categories", { includeHidden: true });
    if (!again.category_groups.some((g) => g.categories.some((c) => c.name === name))) {
      await call("ynab_create_category", { group: groupName, name });
    }
  }
});

await step("outflow lowers the balance and is signed negative", async () => {
  const before = (await call("ynab_list_accounts")).accounts.find((a) => a.id === checking.id).balance;
  const res = await call("ynab_create_transactions", {
    transactions: [{ account: checking.name, date: today, amount, direction: "outflow", payee: "MCP Check Payee", category: "MCP Check A" }],
  });
  assert.equal(res.created.length, 1);
  assert.equal(res.created[0].amount, -amount);
  created.push(res.created[0].id);
  const after = (await call("ynab_list_accounts")).accounts.find((a) => a.id === checking.id).balance;
  assert.equal(Math.round((before - after) * 100), Math.round(amount * 100));
});

await step("a repeated create is skipped as a duplicate", async () => {
  const res = await call("ynab_create_transactions", {
    transactions: [{ account: checking.name, date: today, amount, direction: "outflow", payee: "MCP Check Payee", category: "MCP Check A" }],
  });
  assert.equal(res.created.length, 0);
  assert.equal(res.skipped_duplicates.length, 1);
});

await step("split and transfer", async () => {
  const res = await call("ynab_create_transactions", {
    transactions: [
      {
        account: checking.name,
        date: today,
        amount: amount + 1,
        direction: "outflow",
        payee: "MCP Check Payee",
        splits: [
          { amount: 1, category: "MCP Check B" },
          { amount, category: "MCP Check A" },
        ],
      },
      { account: checking.name, date: today, amount: amount + 2, direction: "outflow", transferToAccount: card.name },
    ],
  });
  assert.equal(res.created.length, 2);
  assert.equal(res.created[0].category, "Split");
  assert.equal(res.created[0].subtransactions.length, 2);
  assert.ok(res.created[1].transfer_account_id);
  created.push(...res.created.map((t) => t.id));
});

await step("update clears a memo, sets a flag, and refuses to edit an existing split", async () => {
  const [plain, split] = created;
  await call("ynab_update_transactions", { transactions: [{ id: plain, memo: "temp", flagColor: "blue" }] });
  const res = await call("ynab_update_transactions", { transactions: [{ id: plain, memo: null }] });
  assert.equal(res.updated[0].memo, null);
  assert.equal(res.updated[0].flag_color, "blue");
  const text = await call(
    "ynab_update_transactions",
    { transactions: [{ id: split, splits: [{ amount: 1 }, { amount }] }] },
    { expectError: true }
  );
  assert.match(text, /already a split/);
});

await step("convert a plain transaction into a split", async () => {
  const [plain] = created;
  const res = await call("ynab_update_transactions", {
    transactions: [{ id: plain, splits: [{ amount: amount - 1, category: "MCP Check A" }, { amount: 1, category: "MCP Check B" }] }],
  });
  assert.equal(res.updated[0].category, "Split");
});

await step("approve: dry run then real", async () => {
  const [plain] = created;
  await call("ynab_update_transactions", { transactions: [{ id: plain, approved: false }] });
  const dry = await call("ynab_approve_transactions", { ids: [plain], dryRun: true });
  assert.equal(dry.would_update_count, 1);
  const real = await call("ynab_approve_transactions", { ids: [plain] });
  assert.equal(real.updated_count, 1);
});

await step("search finds today's transactions newest first by text", async () => {
  const res = await call("ynab_search_transactions", { text: "MCP Check Payee", sinceDate: today });
  assert.ok(res.total_matching >= 2);
});

await step("assign, move money, and put it back", async () => {
  const month = today.slice(0, 7);
  const a0 = await call("ynab_get_category", { category: "MCP Check A", month });
  const b0 = await call("ynab_get_category", { category: "MCP Check B", month });
  await call("ynab_assign", { category: "MCP Check A", month, amount: 5, mode: "add" });
  const moved = await call("ynab_move_money", { from: "MCP Check A", to: "MCP Check B", amount: 5, month });
  assert.ok(moved);
  const b1 = await call("ynab_get_category", { category: "MCP Check B", month });
  const assigned = (c) => c.assigned;
  assert.equal(Math.round((assigned(b1) - assigned(b0)) * 100), 500);
  await call("ynab_assign", { category: "MCP Check A", month, amount: assigned(a0), mode: "set" });
  await call("ynab_assign", { category: "MCP Check B", month, amount: assigned(b0), mode: "set" });
});

await step("scheduled: create, update one field, delete", async () => {
  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const res = await call("ynab_create_scheduled_transaction", {
    account: checking.name,
    date: tomorrow,
    frequency: "monthly",
    amount: 9.99,
    direction: "outflow",
    payee: "MCP Check Payee",
    category: "MCP Check A",
    memo: "before",
  });
  const id = res.scheduled_transaction.id;
  assert.ok(id, `no id in ${JSON.stringify(res)}`);
  createdScheduled.push(id);
  const updated = await call("ynab_update_scheduled_transaction", { scheduledTransactionId: id, memo: "after" });
  const st = updated.scheduled_transaction;
  assert.equal(st.memo, "after");
  assert.equal(st.amount, -9.99, "update must preserve the amount");
  assert.equal(st.category, "MCP Check A", "update must preserve the category");
  await call("ynab_delete_scheduled_transaction", { scheduledTransactionId: id });
  createdScheduled.pop();
});

await step("payees: create returns the existing one; rename and rename back", async () => {
  const res = await call("ynab_create_payee", { name: "mcp check payee" });
  assert.equal(res.already_existed, true);
  await call("ynab_rename_payee", { payee: "MCP Check Payee", name: "MCP Check Payee Renamed" });
  await call("ynab_rename_payee", { payee: "MCP Check Payee Renamed", name: "MCP Check Payee" });
});

await step("reconcile preview changes nothing", async () => {
  const res = await call("ynab_reconcile_account", { account: checking.name, statementBalance: 0 });
  assert.equal(res.applied, false);
});

await step("summary and report still read", async () => {
  await call("ynab_budget_summary");
  await call("ynab_spending_report", { sinceDate: today });
});

await step("clean up created transactions", async () => {
  for (const id of created) {
    try {
      await call("ynab_delete_transaction", { transactionId: id });
    } catch (error) {
      // Deleting one side of a transfer removes the other; that is fine.
      if (!/not found|404/i.test(error.message)) throw error;
    }
  }
  for (const id of createdScheduled) await call("ynab_delete_scheduled_transaction", { scheduledTransactionId: id });
});

await client.close();
for (const [status, label, detail] of results) console.log(`${status.padEnd(4)} ${label}${detail ? `\n     ${detail}` : ""}`);
process.exit(results.some(([status]) => status === "FAIL") ? 1 : 0);
