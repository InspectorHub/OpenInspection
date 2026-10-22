// @vitest-environment happy-dom
/** The poster picker sends the chosen frame through `resources.video.setPoster`, once per press. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import type { FieldResources } from "../../data-source";
import { createEmptyEditorData, createFakeDataSource, createFakeVideo } from "../../testing/fake-data-source";
import { PosterPicker, streamThumbUrl } from "./PosterPicker";

afterEach(cleanup);

function mount(resources: FieldResources, over: Partial<React.ComponentProps<typeof PosterPicker>> = {}) {
    const onClose = vi.fn();
    const ds = createFakeDataSource({ data: createEmptyEditorData(), resources });
    render(
        <FieldDataSourceProvider dataSource={ds}>
            <PosterPicker inspectionId="insp-1" streamUid="uid-1" durationSec={80} streamCustomerSubdomain="customer-x" onClose={onClose} {...over} />
        </FieldDataSourceProvider>,
    );
    return { onClose };
}

const setButton = () => screen.getByRole("button", { name: /set poster|set/i });

describe("PosterPicker", () => {
    it("sets the chosen frame: posterPct is that frame's 0..1 position, then the sheet closes", async () => {
        const video = createFakeVideo();
        const { onClose } = mount({ video });
        act(() => screen.getByTestId("poster-frame-2").click());
        act(() => setButton().click());
        await act(async () => {});
        expect(video.posters).toEqual([{ inspectionId: "insp-1", streamUid: "uid-1", posterPct: 0.25 }]);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("two presses in one frame set the poster once", async () => {
        const video = createFakeVideo();
        mount({ video });
        act(() => {
            setButton().click();
            setButton().click();
        });
        await act(async () => {});
        expect(video.posters).toHaveLength(1);
    });

    it("a host with no video capability sends nothing", () => {
        const { onClose } = mount({});
        act(() => setButton().click());
        expect(onClose).not.toHaveBeenCalled();
    });

    it("fails closed without a customer subdomain", () => {
        const video = createFakeVideo();
        mount({ video }, { streamCustomerSubdomain: null });
        expect(screen.getByTestId("poster-unavailable")).toBeTruthy();
        act(() => setButton().click());
        expect(video.posters).toHaveLength(0);
    });

    it("builds the Stream thumbnail URL from the subdomain", () => {
        expect(streamThumbUrl("sub", "uid", 10)).toBe("https://sub.cloudflarestream.com/uid/thumbnails/thumbnail.jpg?time=10s");
    });
});
