import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as ynab from "ynab";
import { createServer } from "../../server.js";
import { wireSchema } from "../../tools/defineTool.js";
import { listAccounts } from "../../tools/accounts/listAccounts.js";
import { searchTransactions } from "../../tools/transactions/searchTransactions.js";
import { updateTransactions } from "../../tools/transactions/updateTransactions.js";
import { setup } from "../tools/harness.js";
import { tools } from "../../tools/registry.js";
import { USD } from "../../ynab/money.js";
import { Lookup } from "../../ynab/lookup.js";

describe("createServer", () => {
  it("registers every tool with unique names and annotations", async () => {
    const server = createServer({ api: {} as ynab.API, planId: () => "p", rateLimit: () => undefined, currency: async () => USD, lookup: new Lookup({} as ynab.API) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const listed = (await client.listTools()).tools;
    expect(listed.map((t) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
    expect(new Set(listed.map((t) => t.name)).size).toBe(listed.length);
    for (const tool of listed) {
      expect(tool.name).toMatch(/^ynab_[a-z_]+$/);
      expect(tool.annotations?.readOnlyHint).toBeTypeOf("boolean");
    }
    await client.close();
  });

  it("tells the client what the API cannot do", async () => {
    const server = createServer({ api: {} as ynab.API, planId: () => "p", rateLimit: () => undefined, currency: async () => USD, lookup: new Lookup({} as ynab.API) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    expect(client.getInstructions()).toMatch(/cannot do the following/);
    expect(client.getInstructions()).toMatch(/Outputs are signed/);
    await client.close();
  });

  it("rejects unknown arguments, top level and nested, instead of dropping them", async () => {
    const h = setup();
    await expect(h.call(listAccounts, { budgetId: h.planId } as never)).rejects.toThrow(/budgetId/);
    await expect(
      h.call(updateTransactions, { transactions: [{ id: "x", categoryId: "y" }] } as never)
    ).rejects.toThrow(/categoryId/);
  });

  it("treats null on an optional field as not given, keeping defaults", async () => {
    const h = setup();
    const { data } = await h.call(searchTransactions, { planId: null, sort: null, limit: null, sinceDate: "2024-01-01" } as never);
    expect(data.returned).toBeGreaterThan(0);
    expect(data.transactions[0].date >= data.transactions.at(-1).date).toBe(true);
  });

  it("keeps null meaning clear where a field accepts it", async () => {
    const h = setup();
    const [txn] = (await h.call(searchTransactions, { text: "Downtown Cafe", sinceDate: "2024-01-01", limit: 1 })).data.transactions;
    await h.call(updateTransactions, { transactions: [{ id: txn.id, memo: "note", flagColor: "red" }] });
    const { data } = await h.call(updateTransactions, { transactions: [{ id: txn.id, memo: null, flagColor: null }] });
    expect(data.updated[0]).toMatchObject({ memo: null, flag_color: null });
  });

  it("advertises strict schemas that accept null on optional fields", async () => {
    const schema = wireSchema(searchTransactions);
    expect(schema.safeParse({ limit: null }).success).toBe(true);
    expect(schema.safeParse({ nope: 1 }).success).toBe(false);
  });
});
