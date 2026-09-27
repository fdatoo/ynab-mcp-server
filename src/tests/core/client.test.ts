import { describe, expect, it, vi } from "vitest";
import { createYnabClient } from "../../ynab/client.js";

function jsonResponse(status: number, body: unknown, rateLimit = "5/200") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Rate-Limit": rateLimit },
  });
}

const user = { data: { user: { id: "u1" } } };

describe("createYnabClient", () => {
  it("sends the token and records the rate limit", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse(200, user, "37/200"));
    const client = createYnabClient("secret", { fetch: fetchMock });
    await client.api.user.getUser();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret");
    expect(client.rateLimit()).toEqual({ used: 37, limit: 200 });
  });

  it("retries a GET once after a 5xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: { id: "503", name: "service_unavailable", detail: "down" } }))
      .mockResolvedValueOnce(jsonResponse(200, user));
    const client = createYnabClient("t", { fetch: fetchMock, retryDelayMs: 0 });
    await expect(client.api.user.getUser()).resolves.toEqual(user);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a GET once after a network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(jsonResponse(200, user));
    const client = createYnabClient("t", { fetch: fetchMock, retryDelayMs: 0 });
    await expect(client.api.user.getUser()).resolves.toEqual(user);
  });

  it("does not retry writes", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(503, { error: { id: "503", name: "service_unavailable", detail: "down" } }));
    const client = createYnabClient("t", { fetch: fetchMock, retryDelayMs: 0 });
    await expect(client.api.transactions.deleteTransaction("p", "t1")).rejects.toMatchObject({ error: { id: "503" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry 4xx", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(404, { error: { id: "404.2", name: "resource_not_found", detail: "nope" } }));
    const client = createYnabClient("t", { fetch: fetchMock, retryDelayMs: 0 });
    await expect(client.api.user.getUser()).rejects.toMatchObject({ error: { id: "404.2" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
