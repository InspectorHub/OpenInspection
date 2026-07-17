import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { InspectorSyncBadge, syncBadgeState } from "./InspectorSyncBadge";
import { m } from "~/paraglide/messages";

const NOW = Date.UTC(2026, 7, 3, 12, 0, 0);
const HOUR = 3_600_000;

describe("syncBadgeState", () => {
  it("reports a missing connection as not-connected", () => {
    expect(syncBadgeState(false, null, NOW)).toBe("not-connected");
  });

  it("reports a sync older than a day as stale", () => {
    expect(syncBadgeState(true, NOW - 30 * HOUR, NOW)).toBe("stale");
  });

  it("reports a recent sync as connected", () => {
    expect(syncBadgeState(true, NOW - HOUR, NOW)).toBe("connected");
  });

  it("treats a connection that has never synced as stale", () => {
    expect(syncBadgeState(true, null, NOW)).toBe("stale");
  });

  it("holds connected right up to the 24h boundary and flips past it", () => {
    expect(syncBadgeState(true, NOW - 24 * HOUR, NOW)).toBe("connected");
    expect(syncBadgeState(true, NOW - 24 * HOUR - 1, NOW)).toBe("stale");
  });

  it("ignores a lastSyncAt in the future rather than reporting stale", () => {
    // Clock skew between the worker and the browser must not read as staleness.
    expect(syncBadgeState(true, NOW + HOUR, NOW)).toBe("connected");
  });

  it("reports a disconnected inspector as not-connected even with an old sync", () => {
    expect(syncBadgeState(false, NOW - 30 * HOUR, NOW)).toBe("not-connected");
  });
});

describe("InspectorSyncBadge", () => {
  function renderBadge(connected: boolean, lastSyncAt: number | null) {
    return render(
      <InspectorSyncBadge connected={connected} lastSyncAt={lastSyncAt} now={NOW} locale="en-US" />,
    );
  }

  it("marks each state on the rendered badge", () => {
    expect(renderBadge(false, null).container.querySelector("[data-sync-state]")
      ?.getAttribute("data-sync-state")).toBe("not-connected");
    expect(renderBadge(true, NOW - 30 * HOUR).container.querySelector("[data-sync-state]")
      ?.getAttribute("data-sync-state")).toBe("stale");
    expect(renderBadge(true, NOW - HOUR).container.querySelector("[data-sync-state]")
      ?.getAttribute("data-sync-state")).toBe("connected");
  });

  it("titles a connected badge with the translated status and how long ago it synced", () => {
    const { container } = renderBadge(true, NOW - HOUR);
    const title = container.querySelector("[data-sync-state]")?.getAttribute("title");
    expect(title).toContain(m.calendar_sync_connected());
    expect(title).toContain("hour");
  });

  it("titles a not-connected badge without a relative time", () => {
    const { container } = renderBadge(false, null);
    const title = container.querySelector("[data-sync-state]")?.getAttribute("title");
    expect(title).toBe(m.calendar_sync_not_connected());
  });

  it("titles a never-synced connection without inventing a relative time", () => {
    const { container } = renderBadge(true, null);
    const title = container.querySelector("[data-sync-state]")?.getAttribute("title");
    expect(title).toBe(m.calendar_sync_stale());
  });
});
