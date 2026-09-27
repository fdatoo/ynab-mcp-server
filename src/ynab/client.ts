import * as ynab from "ynab";

export interface RateLimit {
  used: number;
  limit: number;
}

export interface YnabClient {
  api: ynab.API;
  /** The most recent X-Rate-Limit reading, if any request has completed. */
  rateLimit(): RateLimit | undefined;
}

export interface ClientOptions {
  fetch?: typeof fetch;
  /** Delay before the single retry of a failed GET. */
  retryDelayMs?: number;
}

const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);

/**
 * ynab.API builds its own Configuration and offers no way to pass a fetch
 * implementation, so this subclass replaces it.
 */
class ConfiguredApi extends ynab.API {
  constructor(token: string, fetchApi: ynab.FetchAPI) {
    super(token);
    this._configuration = new ynab.Configuration({
      accessToken: token,
      basePath: ynab.BASE_PATH,
      fetchApi,
    });
  }
}

function parseRateLimit(header: string | null): RateLimit | undefined {
  const match = header?.match(/^(\d+)\/(\d+)$/);
  return match ? { used: Number(match[1]), limit: Number(match[2]) } : undefined;
}

export function createYnabClient(token: string, options: ClientOptions = {}): YnabClient {
  const baseFetch = options.fetch ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? 500;
  let rateLimit: RateLimit | undefined;

  // GETs are retried once on a network failure or a 5xx. Writes are not:
  // a write that failed in flight may still have been applied.
  const instrumentedFetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const isGet = (init?.method ?? "GET").toUpperCase() === "GET";
    const attempt = async () => {
      const response = await baseFetch(url, init);
      rateLimit = parseRateLimit(response.headers.get("X-Rate-Limit")) ?? rateLimit;
      return response;
    };
    try {
      const response = await attempt();
      if (!isGet || !RETRYABLE_STATUSES.has(response.status)) return response;
    } catch (error) {
      if (!isGet) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    return attempt();
  };

  return {
    api: new ConfiguredApi(token, instrumentedFetch),
    rateLimit: () => rateLimit,
  };
}
