/**
 * The Communication section's pure view logic (design §2/§3.3).
 *
 * The two rules these tests pin, because each was explicitly decided against a
 * plausible wrong alternative:
 * - Notices group on (automation_id, send_at) — NOT event_id, which is set for
 *   report.published and nothing else, so grouping on it would collapse every
 *   other trigger's rows into one giant NULL group.
 * - Raw reason strings map to sentences in the UI, with the raw value kept
 *   visible in the fallback — never a bare machine string, never nothing.
 */
import { describe, it, expect } from "vitest";
import {
  bucketMessages,
  dayKeyInZone,
  groupDeliveries,
  reasonText,
  type DeliveryRow,
  type MessageRow,
} from "./communication-view";

const delivery = (over: Partial<DeliveryRow>): DeliveryRow => ({
  id: Math.random().toString(36).slice(2),
  channel: "email",
  recipient: "a@x.com",
  recipientContactId: null,
  roleKey: "client",
  roleLabel: "Client",
  status: "sent",
  reasonCode: null,
  source: "automation",
  automationId: "auto-1",
  automationName: "Report ready",
  sendAt: 1_000,
  deliveredAt: null,
  ...over,
});

describe("groupDeliveries", () => {
  it("folds one firing (4 people × 2 channels = 8 rows) into ONE notice", () => {
    const rows = ["a", "b", "c", "d"].flatMap((who) => [
      delivery({ recipient: `${who}@x.com`, channel: "email" }),
      delivery({ recipient: `${who}@x.com`, channel: "sms", status: who === "d" ? "skipped" : "sent", reasonCode: who === "d" ? "no sms consent" : null }),
    ]);
    const groups = groupDeliveries(rows);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.recipients).toHaveLength(8);
    const email = g.channels.find((c) => c.channel === "email")!;
    const sms = g.channels.find((c) => c.channel === "sms")!;
    expect(email).toMatchObject({ delivered: 4, total: 4, tone: "quiet" });
    expect(sms).toMatchObject({ delivered: 3, total: 4, tone: "watch" });
    expect(g.needsAttention).toBe(true);
  });

  it("separates two firings of the same rule by send_at", () => {
    const rows = [
      delivery({ sendAt: 1_000 }),
      delivery({ sendAt: 2_000 }),
    ];
    expect(groupDeliveries(rows)).toHaveLength(2);
  });

  it("newest firing sorts first", () => {
    const groups = groupDeliveries([delivery({ sendAt: 1_000 }), delivery({ sendAt: 5_000 })]);
    expect(groups.map((g) => g.sendAt)).toEqual([5_000, 1_000]);
  });

  it("a failed row outranks skipped for the channel tone", () => {
    const groups = groupDeliveries([
      delivery({ status: "failed", reasonCode: "smtp 550" }),
      delivery({ status: "skipped", reasonCode: "no sms consent" }),
    ]);
    expect(groups[0].channels[0].tone).toBe("bad");
  });
});

describe("reasonText", () => {
  it("maps every raw string the send paths write today", () => {
    for (const raw of [
      "no sms consent", "review_url not configured", "sms not configured",
      "email not configured", "no sms template", "no email template",
      "managed_not_approved",
    ]) {
      const text = reasonText(raw)!;
      // A mapped reason is a sentence, not the raw token.
      expect(text).not.toBe(raw);
      expect(text.length).toBeGreaterThan(10);
    }
  });

  it("keeps an unmapped raw value visible inside the fallback sentence", () => {
    expect(reasonText("quota exceeded for tenant")).toContain("quota exceeded for tenant");
  });

  it("returns null for no reason — the row simply has nothing to explain", () => {
    expect(reasonText(null)).toBeNull();
  });
});

const msg = (over: Partial<MessageRow>): MessageRow => ({
  id: Math.random().toString(36).slice(2),
  direction: "in",
  contactId: "c1",
  fromRole: "client",
  fromName: "Dana",
  body: "hi",
  attachments: [],
  createdAt: Date.UTC(2026, 6, 29, 12),
  ...over,
});

describe("bucketMessages", () => {
  it("splits days by the VIEWER's calendar, not UTC", () => {
    // 03:00 UTC on the 30th is still the 29th in Denver. A UTC bucketing would
    // draw a day separator between two messages sent minutes apart.
    const a = msg({ createdAt: Date.UTC(2026, 6, 30, 2, 50) });
    const b = msg({ createdAt: Date.UTC(2026, 6, 30, 3, 5) });
    expect(bucketMessages([a, b], "America/Denver")).toHaveLength(1);
    expect(bucketMessages([a, b], "UTC")).toHaveLength(1);
    const c = msg({ createdAt: Date.UTC(2026, 6, 30, 5, 50) });  // 23:50 Denver 29th
    const d = msg({ createdAt: Date.UTC(2026, 6, 30, 6, 10) });  // 00:10 Denver 30th
    expect(bucketMessages([c, d], "America/Denver")).toHaveLength(2);
  });

  it("groups consecutive messages from one author under one header", () => {
    const days = bucketMessages([
      msg({ body: "1" }), msg({ body: "2" }),
      msg({ body: "3", direction: "out", fromRole: "inspector", fromName: "Sam" }),
      msg({ body: "4" }),
    ], "UTC");
    expect(days[0].groups.map((g) => g.messages.length)).toEqual([2, 1, 1]);
  });

  it("never groups two contacts, even with colliding display names", () => {
    // The inspector view merges several threads; two 'John's must not merge.
    const days = bucketMessages([
      msg({ contactId: "c1", fromName: "John" }),
      msg({ contactId: "c2", fromName: "John" }),
    ], "UTC");
    expect(days[0].groups).toHaveLength(2);
  });
});

describe("dayKeyInZone", () => {
  it("answers in the zone", () => {
    const ms = Date.UTC(2026, 6, 29, 22, 30);
    expect(dayKeyInZone(ms, "Asia/Tokyo")).toBe("2026-07-30");
    expect(dayKeyInZone(ms, "America/New_York")).toBe("2026-07-29");
  });
});
