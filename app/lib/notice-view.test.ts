/**
 * The recipient-facing Notice view logic (design §3.16).
 *
 * The rules here exist because the reader is a CUSTOMER, not an operator, and
 * the two audiences must not share a reason map:
 *
 * - Only reasons that are ABOUT the recipient and ACTIONABLE BY THEM get
 *   words. "That automation has no template", "SMS isn't set up", "still under
 *   review" are our problems; telling a customer leaks operational state and
 *   buys a support ticket. Everything unrecognized collapses to a flat
 *   "Not delivered" with no explanation and no button.
 * - The client list is explicitly enumerated in BOTH directions, so adding a
 *   new internal reason code can never leak by default, and a transient
 *   provider failure never tells someone their address is wrong.
 * - A remedy is only offered where the path behind it exists: "Turn on texts"
 *   is real everywhere; the email remedy opens a composer, so it renders only
 *   where a composer exists (the client hub, not the agent portal).
 */
import { describe, it, expect } from "vitest";
import {
  channelOutcome,
  noticeRemedy,
  noticeTitle,
  type NoticeChannelAttempt,
  type NoticeRowData,
} from "./notice-view";

const channel = (over: Partial<NoticeChannelAttempt>): NoticeChannelAttempt => ({
  channel: "email",
  status: "sent",
  reasonCode: null,
  recipient: "jane@x.com",
  deliveredAt: null,
  sendAt: 1_000,
  ...over,
});

const notice = (channels: NoticeChannelAttempt[]): NoticeRowData => ({
  id: "n-1",
  tenantId: "t-1",
  type: "report.published",
  title: "Your report is ready",
  body: null,
  inspectionId: "insp-1",
  createdAt: 1_000,
  readAt: null,
  channels,
});

describe("channelOutcome", () => {
  it("says the outcome in words — colour is never the only signal", () => {
    expect(channelOutcome(channel({ status: "sent" })).label.length).toBeGreaterThan(3);
    expect(channelOutcome(channel({ status: "pending" })).label.length).toBeGreaterThan(3);
    expect(channelOutcome(channel({ status: "failed" })).label.length).toBeGreaterThan(3);
  });

  it("a delivered channel stays quiet; only what did not arrive takes colour", () => {
    expect(channelOutcome(channel({ status: "sent" })).tone).toBe("quiet");
    expect(channelOutcome(channel({ status: "skipped" })).tone).toBe("watch");
    expect(channelOutcome(channel({ status: "failed" })).tone).toBe("bad");
  });

  it("never renders the raw provider string to a customer", () => {
    const out = channelOutcome(channel({ status: "failed", reasonCode: "smtp 550 5.1.1 unknown user" }));
    expect(out.label).not.toContain("550");
    expect(out.label).not.toContain("smtp");
  });
});

describe("noticeTitle", () => {
  it("replaces the operator's shorthand with a sentence about the reader's own inspection", () => {
    const row = { ...notice([]), type: "manual.send", title: "Manual send" };
    const shown = noticeTitle(row);
    expect(shown).not.toBe("Manual send");
    expect(shown.toLowerCase()).toContain("your inspector");
  });

  it("falls back to the stored title for a type it does not know — never to nothing", () => {
    const row = { ...notice([]), type: "some.future.event", title: "Something happened" };
    expect(noticeTitle(row)).toBe("Something happened");
  });
});

describe("noticeRemedy", () => {
  it("offers Turn on texts for a skipped SMS — the one genuine self-service path", () => {
    const r = noticeRemedy(notice([channel({ channel: "sms", status: "skipped", reasonCode: "no sms consent", recipient: "+15550001111" })]), { emailComposer: true });
    expect(r).toMatchObject({ kind: "sms-consent", noticeId: "n-1" });
  });

  it("offers the email composer for a BOUNCED address, and names the address it failed on", () => {
    const r = noticeRemedy(notice([channel({ status: "failed", reasonCode: "550 mailbox unavailable", recipient: "ray@oldmail.com" })]), { emailComposer: true });
    expect(r).toMatchObject({ kind: "email", address: "ray@oldmail.com" });
  });

  it("stays silent on an UNRECOGNIZED email failure — a provider blip is not the reader's address to fix", () => {
    const r = noticeRemedy(notice([channel({ status: "failed", reasonCode: "connection reset" })]), { emailComposer: true });
    expect(r).toBeNull();
  });

  it("never leaks an operator-only reason as a remedy", () => {
    for (const raw of ["no email template", "sms not configured", "managed_not_approved", "review_url not configured"]) {
      expect(noticeRemedy(notice([channel({ status: "skipped", reasonCode: raw })]), { emailComposer: true })).toBeNull();
    }
  });

  it("withholds the email remedy where no composer exists — never a button with nothing behind it", () => {
    const bounced = notice([channel({ status: "failed", reasonCode: "550 mailbox unavailable", recipient: "ray@oldmail.com" })]);
    expect(noticeRemedy(bounced, { emailComposer: false })).toBeNull();
    // The SMS remedy is real in both portals, so it survives the same switch.
    const skipped = notice([channel({ channel: "sms", status: "skipped", reasonCode: "no sms consent" })]);
    expect(noticeRemedy(skipped, { emailComposer: false })).toMatchObject({ kind: "sms-consent" });
  });

  it("offers at most ONE remedy — consent outranks a bounce", () => {
    const both = notice([
      channel({ status: "failed", reasonCode: "550 mailbox unavailable", recipient: "ray@oldmail.com" }),
      channel({ channel: "sms", status: "skipped", reasonCode: "no sms consent" }),
    ]);
    expect(noticeRemedy(both, { emailComposer: true })).toMatchObject({ kind: "sms-consent" });
  });

  it("a fully delivered notice has nothing to act on", () => {
    expect(noticeRemedy(notice([channel({ status: "sent" })]), { emailComposer: true })).toBeNull();
  });
});
