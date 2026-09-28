import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool, toHandlerInput, wireSchema, type Tool, type ToolContext } from "./tools/defineTool.js";
import { tools as allTools } from "./tools/registry.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

export const INSTRUCTIONS = `Tools for reading and changing a YNAB plan (YNAB's API calls budgets "plans").

Conventions:
- Amounts are in the plan's currency. Inputs are positive with a separate direction ("outflow" for spending, "inflow" for income). Outputs are signed: negative is an outflow.
- Accounts, categories and payees can be given by name. An ambiguous or unknown name returns the candidates; ask the user rather than guessing.
- Plan ids are optional; the configured plan is used by default.
- Creating transactions is protected against repeats: a match on account, date and amount is reported under skipped_duplicates instead of being created again.

The YNAB API cannot do the following, and neither can these tools. Tell the user it has to be done in the YNAB app instead of trying another route:
- delete or merge categories, category groups, payees or accounts
- hide or unhide categories
- close, reopen or link accounts, or fix a broken bank connection (an account with direct_import_in_error needs attention in the app)
- edit the lines of an existing split transaction (a plain transaction can be turned into a split)
- create scheduled split transactions
- match an imported transaction to a manually entered one by hand
- undo a change
- change plan settings such as currency or date format`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createServer(ctx: ToolContext, tools: Tool<any>[] = allTools): McpServer {
  const server = new McpServer({ name: "ynab-mcp-server", version }, { instructions: INSTRUCTIONS });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: wireSchema(tool),
        annotations: tool.annotations,
      },
      (input: Record<string, unknown>) => runTool(tool, toHandlerInput(tool, input), ctx)
    );
  }
  return server;
}
