// @vitest-environment happy-dom
/**
 * The sentence that keeps "this did not load" apart from "there is nothing
 * here" (IA-118).
 *
 * Every empty state in this app is phrased as a conclusion — "No contacts yet",
 * "You're all caught up", "No repair items" — so a loader that catches a failure
 * into an empty array causes the page to state that conclusion with full
 * confidence. Each instance found so far failed in the dangerous direction: a
 * contact holding two live report links described as unable to open any, an
 * access audit reporting no third-party grants, an owner losing their
 * management controls because a roster request timed out, and a day's schedule
 * reading as free.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { LoadFailedNotice } from "~/components/LoadFailedNotice";

describe("LoadFailedNotice", () => {
  it("does not describe the result as empty", () => {
    const { container } = render(<LoadFailedNotice />);
    const text = container.textContent ?? "";

    expect(text).toMatch(/could not be loaded/i);
    // The whole point: it must not read like an empty state.
    expect(text).not.toMatch(/^no /i);
    expect(text).toMatch(/reload/i);
  });

  it("names the thing when the page can", () => {
    const { container } = render(<LoadFailedNotice what="Calendar" />);
    expect(container.textContent).toContain("Calendar");
  });

  it("is announced, not merely coloured", () => {
    // A failure that only differs by colour is invisible to a screen reader and
    // to anyone not looking at that corner of the page.
    const { container } = render(<LoadFailedNotice />);
    expect(container.querySelector('[role="alert"], [role="status"]')).toBeTruthy();
  });
});
