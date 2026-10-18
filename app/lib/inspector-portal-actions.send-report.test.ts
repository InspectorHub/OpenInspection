import { describe, it, expect } from "vitest";
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
