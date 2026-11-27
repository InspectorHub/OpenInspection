// @vitest-environment happy-dom
/**
 * Item 3 — the post-publish banner restates the notify choice, but only
 * when the publish was an amendment the choice was offered for.
 *
 * The server honours `notifyClient` on amendments (it decides whether the
 * `report.amended` rules fire at all), so the banner can honestly say which
 * way the submitted choice went, in the editor receipt's own words. A first
 * publish, and a republish after a retract, offered no choice — the banner
 * keeps its single sentence there.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { PublishNotice } from "~/components/inspector-portal/PublishNotice";

afterEach(cleanup);

describe("PublishNotice — restated notify choice (item 3)", () => {
    it("says nothing when there was no publish", () => {
        render(<PublishNotice show={false} notice={{ offered: true, notified: true }} />);
        expect(document.body.textContent).toBe("");
    });

    it("keeps the single sentence when no choice was offered", () => {
        render(<PublishNotice show notice={{ offered: false, notified: false }} />);
        expect(screen.getByText(/Report published\./)).toBeTruthy();
        expect(screen.queryByText(/report-updated notices/)).toBeNull();
    });

    it("restates the ticked choice with the receipt's notified sentence", () => {
        render(<PublishNotice show notice={{ offered: true, notified: true }} />);
        expect(screen.getByText(/Report published\./)).toBeTruthy();
        expect(screen.getByText(/The report-updated notices were queued\./)).toBeTruthy();
        expect(screen.queryByText(/No report-updated notices/)).toBeNull();
    });

    it("restates the unticked choice with the receipt's not-notified sentence", () => {
        render(<PublishNotice show notice={{ offered: true, notified: false }} />);
        expect(screen.getByText(/Report published\./)).toBeTruthy();
        expect(screen.getByText(/No report-updated notices were sent for this update\./)).toBeTruthy();
        expect(screen.queryByText(/were queued/)).toBeNull();
    });
});
