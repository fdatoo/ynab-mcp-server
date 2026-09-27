import { describe, expect, it } from "vitest";
import { createPayee } from "../../../tools/payees/createPayee.js";
import { ynabError } from "../../fakes/ynab.js";
import { setup } from "../harness.js";

describe("ynab_create_payee", () => {
  it("creates a payee with the given name", async () => {
    const h = setup();
    const { data } = await h.call(createPayee, { name: "New Landlord" });
    expect(data.payee).toMatchObject({ name: "New Landlord" });
  });

  it("makes the new payee resolvable by name afterwards", async () => {
    const h = setup();
    await h.call(createPayee, { name: "New Landlord" });
    const payee = await h.ctx.lookup.resolvePayee(h.planId, "New Landlord");
    expect(payee.name).toBe("New Landlord");
  });

  it("reports API failures as errors", async () => {
    const h = setup();
    h.fake.failNext("payees.createPayee", ynabError("400", "bad_request", "Invalid payee"));
    const result = await h.call(createPayee, { name: "New Landlord" });
    expect(result).toMatchObject({ isError: true, text: "Invalid payee (YNAB error 400)" });
  });

  it("returns the existing payee instead of creating a duplicate", async () => {
    const h = setup();
    const { data } = await h.call(createPayee, { name: "corner grocer" });
    expect(data).toMatchObject({ payee: { name: "Corner Grocer" }, already_existed: true });
    expect(h.fake.calls.some((c) => c.method === "payees.createPayee")).toBe(false);
  });
});
