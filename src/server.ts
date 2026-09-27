import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool, type Tool, type ToolContext } from "./tools/defineTool.js";
import { tools as allTools } from "./tools/registry.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createServer(ctx: ToolContext, tools: Tool<any>[] = allTools): McpServer {
  const server = new McpServer({ name: "ynab-mcp-server", version });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      (input: Record<string, unknown>) => runTool(tool, input, ctx)
    );
  }
  return server;
}
