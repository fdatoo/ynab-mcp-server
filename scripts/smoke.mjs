// Read-only smoke test: starts the built server over stdio and calls tools
// against the real YNAB API. Needs YNAB_API_TOKEN (and optionally YNAB_BUDGET_ID).
// Usage: node scripts/smoke.mjs [tool_name '{"json":"args"}' ...]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env },
  stderr: "ignore",
});
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);

const calls = process.argv.slice(2);
for (let i = 0; i < calls.length; i += 2) {
  const args = calls[i + 1] ? JSON.parse(calls[i + 1]) : {};
  const result = await client.callTool({ name: calls[i], arguments: args });
  const text = result.content?.[0]?.text ?? "";
  console.log(`\n${calls[i]} isError=${!!result.isError}\n${text.slice(0, 600)}`);
}
await client.close();
