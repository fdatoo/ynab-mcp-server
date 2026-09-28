# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to ./dist
npm start            # Start the server
npm run watch        # Development build with file watching
npm run debug        # Debug with MCP inspector
npm test             # Run tests
npm run test:watch   # Run tests with file watching
npm run test:coverage # Run tests with coverage report
```

## Git Best Practices

ALWAYS use conventional commits format (Refer to https://www.conventionalcommits.org/en/v1.0.0/) when creating git commit messages.

## Architecture Overview

This is a **Model Context Protocol (MCP) server** that provides AI tools for interacting with YNAB (You Need A Budget) plans. Built with `@modelcontextprotocol/sdk`. The YNAB API calls budgets "plans"; the code follows the API.

### Core Structure
- `src/index.ts`: entry point. Loads config, builds the client and context, starts stdio.
- `src/config.ts`: env parsing. Fails at startup without a token.
- `src/server.ts`: `createServer(ctx)` registers every tool in `src/tools/registry.ts`.
- `src/context.ts`: builds the `ToolContext` handed to every tool (API client, plan id resolution, currency, lookup cache).
- `src/ynab/`: `client.ts` (fetch wrapper: rate-limit tracking, one retry for failed GETs), `errors.ts` (normalizes everything the SDK throws), `money.ts` (milliunit conversion and formatting per plan currency), `lookup.ts` (cached accounts, categories and payees; name-to-id resolution).
- `src/tools/<domain>/*.ts`: one tool per file, each a `defineTool({...})` export.
- `src/tests/`: `core/` for the modules above, `tools/` per tool, `fakes/ynab.ts` for the in-memory YNAB fake.

### Tool contract
`defineTool` (in `src/tools/defineTool.ts`) takes `name`, `title`, `description`, a zod `inputSchema` shape, MCP `annotations`, and `handler(input, ctx)`. The handler returns plain data and throws on failure; `runTool` serializes the data and turns any throw into an `isError` result with a readable message. Input types come from the schema, so there are no hand-written input interfaces. Handlers never read `process.env`; they use `ctx.planId(input.planId)`.

### Environment Variables
- `YNAB_API_TOKEN` (required): Personal Access Token from YNAB.
- `YNAB_PLAN_ID` (optional): default plan. `YNAB_BUDGET_ID` is still accepted. Without either, the API's "last-used" plan is used.

## Adding New Tools

1. Create `src/tools/<domain>/myTool.ts`:
```typescript
import { z } from "zod";
import { defineTool } from "../defineTool.js";
import { planIdParam } from "../common.js";

export const myTool = defineTool({
  name: "ynab_my_tool",
  title: "My Tool",
  description: "What this tool does",
  inputSchema: {
    planId: planIdParam,
    requiredParam: z.string().describe("Description of required param"),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async handler(input, ctx) {
    const response = await ctx.api.someApi.someMethod(ctx.planId(input.planId), input.requiredParam);
    return { result: response.data };
  },
});
```

2. Add it to the array in `src/tools/registry.ts`.

3. Add `src/tests/tools/<domain>/myTool.test.ts` using `setup()` from `src/tests/tools/harness.ts`, which runs the tool against the in-memory fake the way the server does. The fake returns transactions oldest first and treats positive amounts as inflows, as the real API does. Extend the fake if the tool needs an endpoint it lacks.

4. `scripts/smoke.mjs` runs the built server against the real API (read-only tools only, unless pointed at a sandbox plan).

## YNAB API behaviour worth knowing

Each of these was verified against the live API and each once caused a bug. The fake in `src/tests/fakes/ynab.ts` models them; keep it that way.

- Transactions come back oldest first. Positive amounts are inflows. Amounts are milliunits (thousandths of the currency unit, whatever the currency).
- SDK 4 put a positional `untilDate` before `type` on every `getTransactions*` method. A type-only call must pass `undefined` for it.
- `type=uncategorized` also returns both legs of transfers between the user's own accounts.
- A created batch comes back in the API's order (by id in practice), not request order.
- Setting `import_id` marks a transaction as imported, and YNAB will then not match it to the bank's own import.
- The API sets `internal: true` on YNAB's default category groups (Bills, Needs, Wants, Credit Card Payments), not just the system group. Filter on the category's own `internal` flag.
- A transaction categorised to a credit card payment category is stored as Uncategorized without an error. Those categories are recognised by their "Credit Card Payments" group.
- YNAB fills in a known payee's usual category when a transaction is created without one.
- A split's lines cannot be edited once it exists; a plain transaction can be turned into a split. Split parents keep their payee.
- Clearing a flag takes `null`; the empty string is rejected.
- Scheduled transaction update is a full replace (PUT): send every field.
- Categories cannot be hidden or deleted, and payees cannot be deleted, through the API.
- "Starting Balance", "Manual Balance Adjustment" and "Reconciliation Balance Adjustment" are YNAB's own payees, recognisable only by name.
- Rate limit: 200 requests per hour per token.

## YNAB API Reference
- YNAB SDK types: `node_modules/ynab/dist/index.d.ts`
- OpenAPI spec: https://api.ynab.com/papi/open_api_spec.yaml
- Amounts are in milliunits (multiply dollars by 1000)