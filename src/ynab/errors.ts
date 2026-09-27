import * as ynab from "ynab";

/**
 * An error from the YNAB API, or from reaching it, with a message written for
 * the model reading the tool result.
 */
export class YnabError extends Error {
  constructor(
    message: string,
    /** HTTP status, when known. */
    readonly status?: number,
    /** YNAB's error id, e.g. "404.2". */
    readonly id?: string
  ) {
    super(message);
    this.name = "YnabError";
  }
}

interface YnabErrorBody {
  error: { id?: string; name?: string; detail?: string };
}

function isYnabErrorBody(value: unknown): value is YnabErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "object" &&
    (value as { error: unknown }).error !== null
  );
}

/**
 * Normalizes anything a YNAB call can throw. The SDK throws the parsed JSON
 * error body on a non-2xx response ({ error: { id, name, detail } }), where
 * the id starts with the HTTP status; a FetchError when the request never
 * completed; and a SyntaxError when an error response was not JSON.
 */
export function toYnabError(error: unknown): Error {
  if (error instanceof YnabError) return error;

  if (isYnabErrorBody(error)) {
    const { id, name, detail } = error.error;
    const status = id ? Number.parseInt(id, 10) : undefined;
    if (status === 401) {
      return new YnabError(
        "YNAB rejected the access token (401). Check YNAB_API_TOKEN; the token may have been revoked.",
        status,
        id
      );
    }
    if (status === 429) {
      return new YnabError(
        "YNAB's rate limit is exhausted (200 requests per hour per token). Wait before retrying.",
        status,
        id
      );
    }
    const text = detail || name || "Unknown YNAB error";
    return new YnabError(id ? `${text} (YNAB error ${id})` : text, Number.isNaN(status) ? undefined : status, id);
  }

  if (error instanceof ynab.FetchError) {
    return new YnabError(`Could not reach the YNAB API: ${error.cause?.message ?? error.message}`);
  }
  if (error instanceof SyntaxError) {
    return new YnabError("The YNAB API returned an error response that was not JSON.");
  }
  if (error instanceof Error) return error;
  return new Error(String(error));
}
