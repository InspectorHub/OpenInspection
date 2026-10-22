// @vitest-environment happy-dom
/**
 * The capture flow on a fake data source: createUpload -> uploadFile -> (r2: uploadPoster) -> finalize, what each
 * step is sent, what a refusal at each step shows, and what the host is told when it works.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import { createEmptyEditorData, createFakeDataSource, createFakeVideo } from "../../testing/fake-data-source";
import type { FakeVideo } from "../../testing/fake-data-source";
import { VideoCapture } from "./VideoCapture";

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

function mount(video: FakeVideo | null, provider: "stream" | "r2" = "stream", itemId?: string) {
    const onClose = vi.fn();
    const onUploaded = vi.fn();
    const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: video ? { video } : {} });
    const view = render(
        <FieldDataSourceProvider dataSource={fake}>
            <VideoCapture inspectionId="insp-1" provider={provider} {...(itemId ? { itemId } : {})} onClose={onClose} onUploaded={onUploaded} />
        </FieldDataSourceProvider>,
    );
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    const pick = (f: File) => {
        Object.defineProperty(input, "files", { value: [f], configurable: true });
        act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    };
    return { onClose, onUploaded, pick };
}
const clip = (type = "video/mp4") => new File(["x"], "clip.mp4", { type });
const errorText = () => screen.getByTestId("video-error").textContent;

describe("VideoCapture flow", () => {
    it("stream: creates the upload for the item, sends the clip, finalizes with the stream uid and reports the pool row", async () => {
        const video = createFakeVideo();
        const { onClose, onUploaded, pick } = mount(video, "stream", "item-1");
        pick(clip());
        await settle();
        expect(video.createUploads).toEqual([{ inspectionId: "insp-1", input: { itemId: "item-1" } }]);
        expect(video.uploadedFiles).toEqual(["clip.mp4"]);
        expect(video.posterUploads).toBe(0);
        expect(video.finalizes).toEqual([{ inspectionId: "insp-1", input: { provider: "stream", streamUid: "uid-1" } }]);
        expect(onUploaded).toHaveBeenCalledWith({ poolId: "pool-1", provider: "stream" });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("a clip of the wrong type is refused before anything is sent", async () => {
        const video = createFakeVideo();
        const { pick } = mount(video);
        pick(clip("image/png"));
        await settle();
        expect(video.createUploads).toEqual([]);
        expect(errorText()).toMatch(/format/i);
    });

    it("r2: finalizes with the REAL media id and key from the upload, and without a poster when none could be grabbed", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const video = createFakeVideo();
        video.setTicket({ uploadURL: "/up?token=t", provider: "r2", ref: { provider: "r2", mediaId: "placeholder", r2Key: "placeholder.mp4" } });
        const { onUploaded, pick } = mount(video, "r2");
        pick(clip());
        // The first-frame grab waits out its 8 s safety net in happy-dom, which has no video decoder.
        await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
        expect(video.finalizes).toEqual([{ inspectionId: "insp-1", input: { provider: "r2", mediaId: "media-1", r2Key: "r2/media-1.mp4" } }]);
        expect(video.posterUploads).toBe(0);
        expect(onUploaded).toHaveBeenCalledWith({ poolId: "pool-1", provider: "r2" });
    });

    it("shows the host's reason when create-upload is refused, and its own sentence when the host gave none", async () => {
        const video = createFakeVideo();
        video.failCreateUpload("The video service has no storage left.");
        const { pick, onUploaded } = mount(video);
        pick(clip());
        await settle();
        expect(errorText()).toBe("The video service has no storage left.");
        expect(onUploaded).not.toHaveBeenCalled();
        cleanup();

        const bare = createFakeVideo();
        bare.failCreateUpload();
        const second = mount(bare);
        second.pick(clip());
        await settle();
        expect(errorText()).toMatch(/unexpected response/i);
    });

    it("a failed file upload and a refused finalize each return to the pick step with a message, and report nothing", async () => {
        const upload = createFakeVideo();
        upload.failUploadFile();
        const first = mount(upload);
        first.pick(clip());
        await settle();
        expect(errorText()).toMatch(/upload failed/i);
        expect(upload.finalizes).toEqual([]);
        expect(first.onUploaded).not.toHaveBeenCalled();
        cleanup();

        const finalize = createFakeVideo();
        finalize.failFinalize("Too late");
        const second = mount(finalize);
        second.pick(clip());
        await settle();
        expect(errorText()).toBe("Too late");
        expect(second.onUploaded).not.toHaveBeenCalled();
        expect(second.onClose).not.toHaveBeenCalled();
        expect(screen.getByTestId("pick-button")).toBeTruthy();
    });

    it("a host with no video flow says the upload failed instead of doing nothing", async () => {
        const { pick, onUploaded } = mount(null);
        pick(clip());
        await settle();
        expect(errorText()).toMatch(/upload failed/i);
        expect(onUploaded).not.toHaveBeenCalled();
    });
});
