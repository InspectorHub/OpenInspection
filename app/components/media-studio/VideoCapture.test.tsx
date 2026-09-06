// @vitest-environment happy-dom
/**
 * `VideoCapture` — the R2 privacy notice, and the thing it actually gates.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `docs/integrations/video.md` listed a test for this component. The file it
 * named had never existed and nothing referenced `VideoCapture` in any spec,
 * while the component shipped — so the coverage table promised a regression net
 * that was not there.
 *
 * ⚠️ The doc described the behaviour as "privacy checkbox present (R2), absent
 * (Stream)". That is true and it is not the point: the checkbox's PURPOSE is
 * that it disables the pick button until accepted (`pickDisabled`). A test that
 * only asserted presence would stay green if the gate were removed and the
 * notice left decorative — an R2 upload could then start with nobody having
 * accepted anything. Both halves are asserted here, and the gate is the one
 * that matters.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { VideoCapture } from "~/components/media-studio/VideoCapture";

const BASE = {
    inspectionId: "insp-1",
    itemId: "item-1",
    onClose: () => {},
    onUploaded: () => {},
};

describe("VideoCapture privacy notice, by provider", () => {
    it("shows the notice for R2", () => {
        const { getByTestId } = render(<VideoCapture {...BASE} provider="r2" />);
        expect(getByTestId("r2-privacy-notice")).toBeTruthy();
        expect(getByTestId("r2-privacy-checkbox")).toBeTruthy();
    });

    it("does NOT show it for Stream", () => {
        // The negative half. Cloudflare Stream strips the GPS-leak path, so the
        // acceptance is an R2-only obligation; showing it on Stream would ask
        // for consent to something that does not happen.
        const { queryByTestId } = render(<VideoCapture {...BASE} provider="stream" />);
        expect(queryByTestId("r2-privacy-notice")).toBeNull();
        expect(queryByTestId("r2-privacy-checkbox")).toBeNull();
    });
});

describe("VideoCapture blocks the R2 upload until the notice is accepted", () => {
    it("disables the pick button while unaccepted, and enables it on accept", () => {
        const { getByTestId } = render(<VideoCapture {...BASE} provider="r2" />);
        const pick = getByTestId("pick-button") as HTMLButtonElement;

        // THE ASSERTION THIS FILE EXISTS FOR. A decorative checkbox — one that
        // renders but gates nothing — passes every presence test and lets an
        // upload start with no acceptance recorded.
        expect(pick.disabled).toBe(true);

        fireEvent.click(getByTestId("r2-privacy-checkbox"));
        expect(pick.disabled).toBe(false);
    });

    it("leaves Stream's pick button enabled from the start", () => {
        // Control: proves the assertion above is measuring the acceptance gate
        // and not something that disables the button for every provider.
        const { getByTestId } = render(<VideoCapture {...BASE} provider="stream" />);
        expect((getByTestId("pick-button") as HTMLButtonElement).disabled).toBe(false);
    });
});
