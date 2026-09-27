import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as ynab from "ynab";
import { createServer } from "../../server.js";
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
});
