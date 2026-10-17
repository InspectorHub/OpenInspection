import { describe, it, expect } from "vitest";
import { sendReportActionResult, deliveryActionResult } from "~/lib/inspector-portal-actions";

const res = (status: number, body: unknown = {}) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

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
    expect(await sendReportActionResult(res(200))).toEqual({ ok: true, intent: "send-report", error: undefined });
  });
});

describe("a send that reached nobody is not a success", () => {
  const delivered = (sentTo: string[], skipped?: Array<{ recipient: string; reason: string }>) =>
    res(200, { success: true, data: { sentTo, ...(skipped ? { skipped } : {}) } });

  it("send-report: every recipient skipped reports the reason instead of closing the dialog", async () => {
    const out = await sendReportActionResult(delivered([], [{ recipient: "c1", reason: "No email on file" }]));
    expect(out).toMatchObject({ ok: false, intent: "send-report" });
    expect(out.error).toContain("No email on file");
  });

  it("send-sms: every recipient skipped reports the reason", async () => {
    const out = await deliveryActionResult(delivered([], [{ recipient: "c1", reason: "no sms consent" }, { recipient: "c2", reason: "sms not configured" }]), "send-sms", "failed");
    expect(out).toMatchObject({ ok: false, intent: "send-sms" });
    expect(out.error).toContain("no sms consent");
    expect(out.error).toContain("sms not configured");
  });

  it("control: someone reached (even with others skipped) and an empty skipped list are successes", async () => {
    expect((await sendReportActionResult(delivered(["a@x.test"], [{ recipient: "c2", reason: "No email on file" }]))).ok).toBe(true);
    expect((await deliveryActionResult(delivered(["+15555550100"]), "send-sms", "failed")).ok).toBe(true);
    expect((await deliveryActionResult(res(200, { success: true }), "send-sms", "failed")).ok).toBe(true);
  });
});
