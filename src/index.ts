#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createContext } from "./context.js";
import { createServer } from "./server.js";
import { createYnabClient } from "./ynab/client.js";

async function main() {
  const config = loadConfig();
  const client = createYnabClient(config.token);
  const server = createServer(createContext(config, client));
  await server.connect(new StdioServerTransport());
  console.error("YNAB MCP server running on stdio");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
