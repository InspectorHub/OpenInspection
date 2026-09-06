// @vitest-environment happy-dom
/**
 * `VideoPlayer` — the provider branch, and the three ways it refuses.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `docs/integrations/video.md` listed a test for this component in its coverage
 * table. The file it named had never existed, and a search across every spec
 * found nothing referencing `VideoPlayer` at all — while the component shipped.
 * The table was telling readers that provider-conditional rendering was
 * regression-tested when nothing tested it.
 *
 * ⚠️ The doc described two branches (iframe for Stream, native <video> for R2).
 * The component has FIVE, and the three it omitted are the fail-closed ones —
 * exactly the paths a regression would reach first, because they are what runs
 * when a field is missing. They are asserted here by name.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { VideoPlayer, streamIframeSrc } from "~/components/media-studio/VideoPlayer";

const STREAM = { streamUid: "abc123", streamCustomerSubdomain: "customer-xyz" };
const R2 = { inspectionId: "insp-1", mediaId: "media-9" };

describe("VideoPlayer provider branch", () => {
    it("renders a Stream iframe pointing at the customer subdomain", () => {
        const { getByTestId, container } = render(
            <VideoPlayer provider="stream" {...STREAM} />,
        );
        expect(getByTestId("video-player")).toBeTruthy();
        const iframe = container.querySelector("iframe");
        expect(iframe?.getAttribute("src"))
            .toBe("https://customer-xyz.cloudflarestream.com/abc123/iframe");
        // NEGATIVE HALF: a component that rendered both elements would satisfy
        // the assertion above and still be wrong.
        expect(container.querySelector("video")).toBeNull();
    });

    it("renders a native <video> served by the worker for R2", () => {
        const { getByTestId, container } = render(<VideoPlayer provider="r2" {...R2} />);
        expect(getByTestId("video-player-r2")).toBeTruthy();
        const video = container.querySelector("video");
        expect(video?.getAttribute("src"))
            .toBe("/api/inspections/insp-1/media/video/r2-object/media-9");
        // The poster is a distinct route, not the object itself. Getting this
        // wrong shows a still frame that is actually the whole video.
        expect(video?.getAttribute("poster"))
            .toBe("/api/inspections/insp-1/media/video/r2-object/media-9/poster");
        expect(container.querySelector("iframe")).toBeNull();
    });
});

describe("VideoPlayer fails closed rather than guessing", () => {
    it("refuses a Stream clip with no customer subdomain", () => {
        // The component's own header calls this out: fabricating a subdomain
        // would produce a broken player that looks like a loading one.
        const { getByTestId, container } = render(
            <VideoPlayer provider="stream" streamUid="abc123" streamCustomerSubdomain={null} />,
        );
        expect(getByTestId("video-unavailable")).toBeTruthy();
        expect(container.querySelector("iframe")).toBeNull();
    });

    it("refuses an R2 clip missing the ids its URL is built from", () => {
        const { getByTestId, container } = render(
            <VideoPlayer provider="r2" inspectionId="insp-1" />,
        );
        expect(getByTestId("video-unavailable")).toBeTruthy();
        // Without this, a missing mediaId would render <video src=".../undefined">
        expect(container.querySelector("video")).toBeNull();
    });

    it("shows transcoding progress instead of an empty player", () => {
        const { getByTestId } = render(
            <VideoPlayer provider="stream" {...STREAM} readyToStream={false} pctComplete={42} />,
        );
        const el = getByTestId("video-processing");
        expect(el.textContent).toContain("42");
    });

    it("shows the processing state without a percentage when none is known", () => {
        // NEGATIVE CONTROL for the assertion above: `pctComplete` is optional,
        // and `Math.round(undefined)` would print "NaN%" at a user.
        const { getByTestId } = render(
            <VideoPlayer provider="stream" {...STREAM} readyToStream={false} />,
        );
        expect(getByTestId("video-processing").textContent).not.toContain("NaN");
    });
});

describe("streamIframeSrc", () => {
    it("builds the embed URL from the subdomain and uid", () => {
        expect(streamIframeSrc("sub", "uid"))
            .toBe("https://sub.cloudflarestream.com/uid/iframe");
    });
});
