import type { Config } from "./config.js";
import type { YnabClient } from "./ynab/client.js";
import type { Currency } from "./ynab/money.js";
import { Lookup } from "./ynab/lookup.js";
import type { ToolContext } from "./tools/defineTool.js";

export function createContext(config: Pick<Config, "defaultPlanId">, client: YnabClient): ToolContext {
  const planId = (explicit?: string) => explicit || config.defaultPlanId || "last-used";
  // Currency settings effectively never change, so one request per plan per process.
  const currencies = new Map<string, Promise<Currency>>();

  return {
    api: client.api,
    planId,
    rateLimit: client.rateLimit,
    lookup: new Lookup(client.api),
    currency(id) {
      let currency = currencies.get(id);
      if (!currency) {
        currency = client.api.plans.getPlanSettingsById(id).then((response) => response.data.settings.currency_format);
        currency.catch(() => currencies.delete(id));
        currencies.set(id, currency);
      }
      return currency;
    },
  };
}
