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

    it("tells the two withdrawal reasons apart, and says a different thing for each", () => {
        // §5.3. "This revision was withdrawn" is true of both causes and
        // actionable for neither: our own field map being wrong means a
        // correction is coming from us and the documents already issued should
        // be issued again once it lands, while an authority's withdrawal means
        // no correction is ever coming and the workspace has to move now.
        const common = {
            version: "7-6",
            withdrawnAt: Date.UTC(2026, 3, 1),
            replacementVersion: "7-7",
        } as const;

        const { unmount } = render(
            <RevisionBanner
                status={{ kind: "withdrawn", reason: "field_map_incorrect", ...common }}
                inspectionDate="2026-05-01"
            />,
        );
        const ours = screen.getByRole("alert").textContent ?? "";
        unmount();

        render(
            <RevisionBanner
                status={{ kind: "withdrawn", reason: "authority_withdrew", ...common }}
                inspectionDate="2026-05-01"
            />,
        );
        const theirs = screen.getByRole("alert").textContent ?? "";

        // Both carry the facts, so the difference below is not one branch
        // simply rendering less than the other.
        for (const text of [ours, theirs]) {
            expect(text).toContain("7-6");
            expect(text).toContain("7-7");
            expect(text).toContain("2026-04-01");
        }
        // The property under test: these two never converge. Compared to each
        // other rather than to a literal chosen in this commit, so a copy edit
        // that reworded both into one sentence still fails here.
        expect(ours).not.toBe(theirs);
        // The distinguishing instruction, stated rather than implied. What
        // actually differs is what happens to the documents already issued: a
        // wrong field map printed answers in the wrong boxes, so they have to
        // go out again; an authority's withdrawal leaves them correct for the
        // dates they were produced for.
        expect(ours).toMatch(/produced again/i);
        expect(theirs).not.toMatch(/produced again/i);
        expect(theirs).toMatch(/authority/i);
        expect(ours).not.toMatch(/authority/i);
        // Still no migration control on either.
        expect(screen.queryByRole("button")).toBeNull();
    });

    it("does not send the reader after a replacement revision that does not exist", () => {
        // An authority may withdraw a revision before publishing its successor.
        // Naming a replacement then would be an instruction to look for a form
        // nobody has, so the null case has copy of its own.
        render(
            <RevisionBanner
                status={{
                    kind: "withdrawn",
                    reason: "authority_withdrew",
                    version: "7-6",
                    withdrawnAt: Date.UTC(2026, 3, 1),
                    replacementVersion: null,
                }}
                inspectionDate="2026-05-01"
            />,
        );
        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent(/authority/i);
        // The positive control against a message that simply omits everything:
        // the withdrawn revision is still named.
        expect(alert).toHaveTextContent("7-6");
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
