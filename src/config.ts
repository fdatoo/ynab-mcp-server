export interface Config {
  token: string;
  /** Plan used when a tool call does not name one. */
  defaultPlanId?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.YNAB_API_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "YNAB_API_TOKEN is not set. Create a personal access token at " +
        "https://app.ynab.com/settings/developer and pass it in the server's environment."
    );
  }
  // YNAB_BUDGET_ID predates the API's rename of budgets to plans and is still honoured.
  const defaultPlanId = env.YNAB_PLAN_ID?.trim() || env.YNAB_BUDGET_ID?.trim() || undefined;
  return { token, defaultPlanId };
}
