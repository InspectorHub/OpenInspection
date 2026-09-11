// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  /**
   * F34 — the not-connected label was `text-ih-fg-4` inside an 11px span:
   * 2.56:1 on a light card, 3.07:1 on a dark one, both below AA for text at
   * that size. `lint:contrast` cannot see it, because the colour is looked up
   * from a `Record` rather than written into a class string, so the assertion
   * has to live here.
   *
   * `text-ih-fg-3` (4.76 / 5.71 / 12.02 on `--ih-bg-card`) is the token the
   * neighbouring fixes chose for text on the plain card surface — `.ih-eyebrow`
   * in app/styles/tailwind.css says so in as many words. The fg-2 cases
   * (`.ih-kbd`, `.ih-pill--ni`, the TabStrip count pill, the Stripe
   * "Not connected" chip) are the ones that paint their OWN `--ih-bg-muted`
   * background, where fg-3 falls to 4.34:1. This badge paints no background of
   * its own, so it is an eyebrow-shaped case, not a chip-shaped one.
   */
  it("labels a missing connection with a token that clears AA at 11px", () => {
    const { container } = renderBadge(false, null);
    const label = container.querySelector("[data-sync-label]") as HTMLElement;
    // The failing token, named so a regression cannot pass by being "some other grey".
    expect(label.className).not.toContain("text-ih-fg-4");
    expect(label.className).toContain("text-ih-fg-3");
  });

  // Positive control for the assertion above: the other two states were already
  // readable and must not be flattened into the same grey by this fix.
  it("leaves the readable states on the tokens they already had", () => {
    expect(
      (renderBadge(true, NOW - HOUR).container.querySelector("[data-sync-label]") as HTMLElement)
        .className,
    ).toContain("text-ih-fg-3");
    expect(
      (renderBadge(true, NOW - 30 * HOUR).container
        .querySelector("[data-sync-label]") as HTMLElement).className,
    ).toContain("text-ih-watch-fg");
  });

  // ⚠️ A Tailwind colour class whose token does not exist compiles to NO RULE AT
  // ALL and is invisible everywhere but a browser. Assert the alias is declared
  // rather than trusting that the class string looks plausible.
  it("uses a colour token that the stylesheet actually declares", () => {
    const css = readFileSync(join(import.meta.dirname, "../../styles/tailwind.css"), "utf8");
    expect(css).toContain("--color-ih-fg-3:");
    expect(css).toMatch(/--ih-fg-3:\s*#/);
  });
});
