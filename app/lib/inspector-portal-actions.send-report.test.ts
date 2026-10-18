import { describe, it, expect, afterEach } from "vitest";
import { overwriteGetLocale } from "~/paraglide/runtime";
import { sendReportActionResult, deliveryActionResult } from "~/lib/inspector-portal-actions";

const res = (status: number, body: unknown = {}) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

const delivered = (sentTo: string[], skipped?: Array<{ recipient: string; reason: string; outcome?: string }>) =>
  res(200, { success: true, data: { sentTo, ...(skipped ? { skipped } : {}) } });

describe("sendReportActionResult", () => {
  it("says the report is not published on 409", async () => {
    const out = await sendReportActionResult(res(409, { error: { message: "This report is not published." } }));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not published/i);
  });

  it("says the recipient was sent too often on 429", async () => {
    const out = await sendReportActionResult(res(429));
    expect(out.error).toMatch(/several times/i);
  });

  it("says recipients must be on the inspection on the matching 400", async () => {
    const out = await sendReportActionResult(res(400, { error: { message: "Recipients must be people on this inspection (client, co-client or linked agents)." } }));
    expect(out.error).toMatch(/people on this inspection/i);
  });

  it("passes any other 400 message through, and success through untouched", async () => {
    expect((await sendReportActionResult(res(400, { error: { message: "No recipients" } }))).error).toBe("No recipients");
    expect(await sendReportActionResult(delivered(["a@example.com"]))).toEqual({ ok: true, intent: "send-report", error: undefined });
  });
});

describe("a send that did not reach everyone is not a plain success", () => {
  it("send-report: nobody reached carries who was skipped, with no message string of its own", async () => {
    const out = await sendReportActionResult(delivered([], [{ recipient: "c1", reason: "No email on file", outcome: "skipped" }]));
    expect(out).toMatchObject({ ok: false, intent: "send-report", error: undefined });
    expect(out.delivery).toEqual({ sent: 0, skipped: [{ recipient: "c1", reason: "No email on file", outcome: "skipped" }] });
  });

  it("send-sms: some reached and some not is not ok either, and counts who was reached", async () => {
    const out = await deliveryActionResult(delivered(["+15555550100"], [{ recipient: "c2", reason: "no sms consent", outcome: "skipped" }]), "send-sms", "failed");
    expect(out).toMatchObject({ ok: false, intent: "send-sms" });
    expect(out.delivery?.sent).toBe(1);
    expect(out.delivery?.skipped).toHaveLength(1);
  });

  it("control: everyone reached, and an answer with no skipped list, are plain successes", async () => {
    expect(await deliveryActionResult(delivered(["+15555550100"]), "send-sms", "failed")).toEqual({ ok: true, intent: "send-sms", error: undefined });
  });

  it("an answer that cannot confirm anyone was reached is not a success: unparsable, empty and bodiless answers say so", async () => {
    const unparsable = { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token"); } };
    for (const [label, answer] of [
      ["unparsable body", unparsable],
      ["no data", res(200, { success: true })],
      ["nobody sent, nobody skipped", delivered([])],
      ["sentTo missing", res(200, { success: true, data: {} })],
    ] as const) {
      const out = await deliveryActionResult(answer, "send-sms", "failed");
      expect(out.ok, label).toBe(false);
      expect(out.error, label).toMatch(/could not confirm/i);
      expect(out.delivery, label).toBeUndefined();
    }
    expect((await sendReportActionResult(res(200))).ok).toBe(false);
  });

  it("control: a refused request keeps its message", async () => {
    expect((await deliveryActionResult(res(404, { error: { message: "Inspection not found" } }), "send-sms", "failed")).error).toBe("Inspection not found");
  });
});

describe("a plan refusal is worded by the page, in the viewer's language, never by the server", () => {
  afterEach(() => overwriteGetLocale(() => "en"));

  const QUOTA_EMAIL = { error: { code: "QUOTA_EXHAUSTED", message: "Free plan limit reached: 54/50 email. Subscribe to continue.", details: { metric: "email", used: 54, cap: 50, billingPortalUrl: null } } };
  const NOT_IN_PLAN = { error: { code: "QUOTA_EXHAUSTED", message: "Your company is on the Free plan, which does not include text messages", details: { metric: "sms", used: 0, cap: 0, billingPortalUrl: null } } };
  const SMS_SPENT = { error: { code: "QUOTA_EXHAUSTED", message: "Free plan limit reached: 20/20 sms. Subscribe to continue.", details: { metric: "sms", used: 20, cap: 20, billingPortalUrl: null } } };
  const PROVIDER_QUOTA = { error: { code: "QUOTA_EXHAUSTED", message: "Your email sending quota is exhausted.", details: { metric: "email", used: 0, cap: 0, billingPortalUrl: null } } };

  it("english: the email plan cap names the numbers, and is not the server's sentence", async () => {
    const out = await sendReportActionResult(res(402, QUOTA_EMAIL));
    expect(out.error).toContain("54 of 50");
    expect(out.error).not.toContain("Free plan limit reached: 54/50");
  });

  it("es-419: the same refusal is in Spanish, and nothing of the server's English survives", async () => {
    overwriteGetLocale(() => "es-419");
    const out = await sendReportActionResult(res(402, QUOTA_EMAIL));
    expect(out.error).toContain("54 de 50");
    expect(out.error).toMatch(/límite de correos electrónicos/);
    expect(out.error).not.toMatch(/Free plan|Subscribe/);
  });

  it("es-419: the text message refusals (not in the plan, allowance spent) are in Spanish", async () => {
    overwriteGetLocale(() => "es-419");
    const notIn = await deliveryActionResult(res(402, NOT_IN_PLAN), "send-sms", "failed");
    expect(notIn.error).toMatch(/no incluye mensajes de texto/);
    expect(notIn.error).not.toMatch(/Free plan|company is/);
    const spent = await deliveryActionResult(res(402, SMS_SPENT), "send-sms", "failed");
    expect(spent.error).toContain("20 de 20");
  });

  it("the sending service's own quota (cap 0 on email) gets its own sentence, not '0 of 0'", async () => {
    const out = await sendReportActionResult(res(402, PROVIDER_QUOTA));
    expect(out.error).not.toContain("0 of 0");
    expect(out.error).toMatch(/quota/i);
  });

  it("a QUOTA_EXHAUSTED with an unknown metric or no details falls back to the generic translated sentence", async () => {
    overwriteGetLocale(() => "es-419");
    const out = await sendReportActionResult(res(402, { error: { code: "QUOTA_EXHAUSTED", message: "Free plan limit reached: ?" } }));
    expect(out.error).toBe("Se alcanzó el límite de su plan. Suscríbase para continuar.");
  });

  it("control: a code the page does not know still shows the server's message, and a bare 402 the fallback", async () => {
    expect((await sendReportActionResult(res(403, { error: { code: "SOMETHING_ELSE", message: "Nope." } }))).error).toBe("Nope.");
    expect((await deliveryActionResult(res(402, {}), "send-sms", "fallback text")).error).toBe("fallback text");
  });
});
