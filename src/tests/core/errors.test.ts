import { describe, expect, it } from "vitest";
import * as ynab from "ynab";
import { YnabError, toYnabError } from "../../ynab/errors.js";

const body = (id: string, name: string, detail: string) => ({ error: { id, name, detail } });

describe("toYnabError", () => {
  it("reads the status from the YNAB error id", () => {
    const error = toYnabError(body("404.2", "resource_not_found", "Resource not found"));
    expect(error).toBeInstanceOf(YnabError);
    expect(error.message).toBe("Resource not found (YNAB error 404.2)");
    expect((error as YnabError).status).toBe(404);
  });

  it("explains 401 and 429", () => {
    expect(toYnabError(body("401", "unauthorized", "Unauthorized")).message).toMatch(/access token/);
    expect(toYnabError(body("429", "too_many_requests", "Too many requests")).message).toMatch(/rate limit/);
  });

  it("handles network failures and non-JSON error bodies", () => {
    expect(toYnabError(new ynab.FetchError(new Error("ECONNRESET"))).message).toMatch(/Could not reach the YNAB API: ECONNRESET/);
    expect(toYnabError(new SyntaxError("Unexpected token <")).message).toMatch(/not JSON/);
  });

  it("passes other errors through", () => {
    const plain = new Error("bad input");
    expect(toYnabError(plain)).toBe(plain);
    expect(toYnabError("text").message).toBe("text");
  });
});
