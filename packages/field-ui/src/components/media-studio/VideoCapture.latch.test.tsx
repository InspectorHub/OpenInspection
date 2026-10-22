// @vitest-environment happy-dom
/**
 * VideoCapture same-frame latch: every accepted pick mints an upload (a stored object plus a media-pool row),
 * so two change events dispatched in ONE frame must reach create-upload once. The busy phase only lands
 * after a render, which is too late for the second event.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import { createEmptyEditorData, createFakeDataSource, createFakeVideo } from "../../testing/fake-data-source";
import type { FakeVideo } from "../../testing/fake-data-source";
import { VideoCapture } from "./VideoCapture";

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const file = new File(["x"], "clip.mp4", { type: "video/mp4" });

afterEach(cleanup);

function mount(video: FakeVideo) {
    const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { video } });
    const view = render(
        <FieldDataSourceProvider dataSource={fake}>
            <VideoCapture inspectionId="insp-1" provider="stream" onClose={() => {}} onUploaded={() => {}} />
        </FieldDataSourceProvider>,
    );
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    return input;
}
const pick = (input: HTMLInputElement) => input.dispatchEvent(new Event("change", { bubbles: true }));

describe("VideoCapture latch", () => {
    it("starts ONE upload for two same-frame picks", async () => {
        const video = createFakeVideo();
        // create-upload refuses, so the component returns to the pick phase and the control can pick again.
        video.failCreateUpload();
        const input = mount(video);
        act(() => { pick(input); pick(input); });
        await settle();
        expect(video.createUploads).toHaveLength(1);
    });

    it("CONTROL - a later pick, after the first attempt failed, starts another", async () => {
        const video = createFakeVideo();
        video.failCreateUpload();
        const input = mount(video);
        act(() => { pick(input); });
        await settle();
        act(() => { pick(input); });
        await settle();
        expect(video.createUploads).toHaveLength(2);
    });

    it("a pick made while create-upload is still in flight starts nothing (the phase is busy from the first request)", async () => {
        const video = createFakeVideo();
        const release = video.holdCreateUpload();
        const input = mount(video);
        act(() => { pick(input); });
        await settle();
        act(() => { pick(input); });
        await settle();
        expect(video.createUploads).toHaveLength(1);
        release();
        await settle();
    });
});
