import { describe, expect, it } from "vitest";
import { createContext } from "../../context.js";
import { FakeYnab, planFixture, resetIds, ynabError } from "../fakes/ynab.js";

describe("createContext currency", () => {
  function build() {
    resetIds();
    const fake = new FakeYnab();
    const eur = { ...planFixture().currency_format!, iso_code: "EUR", currency_symbol: "€" };
    const planId = fake.addPlan(planFixture({ currency_format: eur }));
    return { fake, planId, ctx: createContext({ defaultPlanId: planId }, { api: fake.api, rateLimit: () => undefined }) };
  }

  it("fetches plan settings once per plan", async () => {
    const { fake, planId, ctx } = build();
    expect((await ctx.currency(planId)).iso_code).toBe("EUR");
    await ctx.currency(planId);
    expect(fake.calls.filter((c) => c.method === "plans.getPlanSettingsById")).toHaveLength(1);
  });

  it("does not cache a failure", async () => {
    const { fake, planId, ctx } = build();
    fake.failNext("plans.getPlanSettingsById", ynabError("503", "service_unavailable", "down"));
    await expect(ctx.currency(planId)).rejects.toBeDefined();
    expect((await ctx.currency(planId)).iso_code).toBe("EUR");
  });
});
