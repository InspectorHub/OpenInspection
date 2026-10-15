import { describe, it, expect } from "vitest";
import { sendReportActionResult } from "~/lib/inspector-portal-actions";

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
