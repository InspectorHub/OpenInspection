import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { InspectorSyncBadge, syncBadgeState } from "./InspectorSyncBadge";
import { formatRelativeTime } from "~/lib/format";
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

  // Quiet when healthy: a connected badge shows only the freshness as visible
  // text — the green dot already carries "synced", so the word is redundant —
  // and in the compact (narrow) form so a row of inspectors stays scannable.
  it("shows the sync freshness as compact visible text when connected", () => {
    const { container } = renderBadge(true, NOW - HOUR);
    const label = container.querySelector("[data-sync-label]");
    expect(label?.textContent).toBe(
      formatRelativeTime(NOW - HOUR, { locale: "en-US", now: NOW, style: "narrow" }),
    );
    expect(label?.textContent).not.toContain(m.calendar_sync_connected());
  });

  // Loud when there is a problem: the label is spelled out on the page, not
  // hidden in a hover tooltip a user might never discover.
  it("spells out a stale connection as visible text", () => {
    const { container } = renderBadge(true, NOW - 30 * HOUR);
    const label = container.querySelector("[data-sync-label]");
    expect(label?.textContent).toBe(m.calendar_sync_stale_short());
  });

  it("spells out a missing connection as visible text", () => {
    const { container } = renderBadge(false, null);
    const label = container.querySelector("[data-sync-label]");
    expect(label?.textContent).toBe(m.calendar_sync_not_connected_short());
  });

  // A connected-but-never-synced calendar is stale, but "Never synced" tells the
  // user something "Out of sync" does not: there is nothing to be out of date.
  it("distinguishes never-synced from out-of-date in the visible label", () => {
    const { container } = renderBadge(true, null);
    const label = container.querySelector("[data-sync-label]");
    expect(label?.textContent).toBe(m.calendar_sync_never());
  });

  // The visible compact label must not double-read for assistive tech; the full
  // status lives in an sr-only node instead.
  it("hides the compact label from screen readers and keeps a full sr-only status", () => {
    const { container } = renderBadge(true, NOW - HOUR);
    const label = container.querySelector("[data-sync-label]");
    expect(label?.getAttribute("aria-hidden")).toBe("true");
    const srOnly = container.querySelector(".sr-only");
    expect(srOnly?.textContent).toContain(m.calendar_sync_connected());
  });
});
