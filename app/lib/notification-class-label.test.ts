import { describe, it, expect, afterEach } from "vitest";
import { overwriteGetLocale } from "~/paraglide/runtime";
import { NOTIFICATION_CLASSES } from "../../server/lib/notifications/classes";
import { notificationClassLabel, TRANSLATED_NOTIFICATION_CLASS_IDS } from "~/lib/notification-class-label";

/**
 * The notification-class names were hard-coded English in the server's class
 * table, so the agent's Settings showed "Shared report link" under an es-419 UI.
 * The server table stays the authority for WHICH classes exist and their English
 * wording; the screen names them through the message catalog, falling back to the
 * server's label for any class it has no key for.
 */
describe("notificationClassLabel", () => {
  afterEach(() => overwriteGetLocale(() => "en"));

  // EVERY class, not only the agent-facing ones: staff and client screens render the same component.
  const agentFacing = NOTIFICATION_CLASSES;

  it("covers every notification class", () => {
    // Asserted against the authority: a new agent-facing class without a key fails here.
    for (const c of agentFacing) expect(TRANSLATED_NOTIFICATION_CLASS_IDS).toContain(c.id);
  });

  it("is the server's own English wording under en", () => {
    overwriteGetLocale(() => "en");
    for (const c of agentFacing) expect(notificationClassLabel(c.id, c.label)).toBe(c.label);
  });

  it("is not the English wording under es-419", () => {
    overwriteGetLocale(() => "es-419");
    for (const c of agentFacing) {
      const label = notificationClassLabel(c.id, c.label);
      expect(label, c.id).not.toBe(c.label);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("falls back to the server label for a class it has no key for", () => {
    overwriteGetLocale(() => "es-419");
    expect(notificationClassLabel("some-future-class", "Server wording")).toBe("Server wording");
  });
});
