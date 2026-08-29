// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RevisionBanner } from "./RevisionBanner";

describe("RevisionBanner", () => {
    it("says nothing when the template is current", () => {
        const { container } = render(<RevisionBanner status={{ kind: "current" }} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("warns before a cutover without asserting anything is wrong", () => {
        render(
            <RevisionBanner
                status={{ kind: "superseding_soon", nextVersion: "7-7", from: Date.UTC(2026, 2, 15) }}
                inspectionDate="2026-03-01"
            />,
        );
        // `status`, not `alert`: nothing is wrong yet and nothing is blocked, so
        // this must not interrupt a screen reader mid-sentence.
        const banner = screen.getByRole("status");
        expect(banner).toHaveTextContent("7-7");
        expect(banner).toHaveTextContent("2026-03-15");
    });

    it("reassures rather than alarms when a newer revision does not apply here", () => {
        render(
            <RevisionBanner
                status={{ kind: "superseded_elsewhere", nextVersion: "7-7", from: Date.UTC(2026, 2, 15) }}
                inspectionDate="2026-03-01"
            />,
        );
        // The reassurance is the point of this state. A banner that only said
        // "superseded" would make an inspector doubt a correct report.
        expect(screen.getByRole("status")).toHaveTextContent(/still.*correct|remains/i);
    });

    it("states the consequence plainly when the form cannot be produced", () => {
        render(
            <RevisionBanner
                status={{ kind: "cannot_produce", applicableVersion: "7-7", templateVersion: "7-6" }}
                inspectionDate="2026-03-20"
            />,
        );
        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent("7-7");
        expect(alert).toHaveTextContent("7-6");
        // No migration control of any kind: there is no migration (spec §3.1).
        // A half-migrated inspection would silently drop answers somebody stood
        // in a building to collect.
        expect(screen.queryByRole("button")).toBeNull();
        expect(screen.queryByRole("link")).toBeNull();
    });
});
