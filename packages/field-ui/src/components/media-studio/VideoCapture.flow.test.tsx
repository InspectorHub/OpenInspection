// @vitest-environment happy-dom
/**
 * The capture flow on a fake data source: createUpload -> uploadFile -> (r2: uploadPoster) -> finalize, what each
 * step is sent, what a refusal at each step shows, and what the host is told when it works.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import { createEmptyEditorData, createFakeDataSource, createFakeVideo } from "../../testing/fake-data-source";
import type { FakeVideo } from "../../testing/fake-data-source";
import { VideoCapture } from "./VideoCapture";
import { videoDurationSec } from "./video-duration";

// happy-dom has no video decoder, so the length probe is replaced; each test says what it reads.
vi.mock("./video-duration", async (importOriginal) => ({ ...(await importOriginal<typeof import("./video-duration")>()), videoDurationSec: vi.fn() }));
const readsLength = vi.mocked(videoDurationSec);
beforeEach(() => { readsLength.mockReset(); readsLength.mockResolvedValue(null); });

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
        expect(onUploaded).toHaveBeenCalledWith({ provider: "stream", poolId: "pool-1", streamUid: "uid-1" });
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
        expect(onUploaded).toHaveBeenCalledWith({ provider: "r2", poolId: "pool-1" });
    });

    it("a clip longer than the limit is refused before anything is sent, with its length and the limit in the message", async () => {
        readsLength.mockResolvedValue(48);
        const video = createFakeVideo();
        const { pick, onUploaded } = mount(video, "r2");
        pick(clip());
        await settle();
        expect(video.createUploads).toEqual([]);
        expect(errorText()).toMatch(/48/);
        expect(errorText()).toMatch(/30/);
        expect(onUploaded).not.toHaveBeenCalled();
    });

    it("a clip whose length the browser cannot read is not refused for it", async () => {
        readsLength.mockResolvedValue(null);
        const video = createFakeVideo();
        const { pick } = mount(video, "stream");
        pick(clip());
        await settle();
        expect(video.createUploads).toHaveLength(1);
    });

    it("the length that was read is reported with the stream clip", async () => {
        readsLength.mockResolvedValue(12.5);
        const video = createFakeVideo();
        const { onUploaded, pick } = mount(video, "stream", "item-1");
        pick(clip());
        await settle();
        expect(onUploaded).toHaveBeenCalledWith({ provider: "stream", poolId: "pool-1", streamUid: "uid-1", durationSec: 12.5 });
    });

    it("a host that gives no limit accepts a 100 MB r2 clip (the native client uploads large clips in parts), and refuses one over the 200 MB default", async () => {
        const clipOf = (mb: number) => {
            const f = new File(["x"], "c.mp4", { type: "video/mp4" });
            Object.defineProperty(f, "size", { value: mb * 1024 * 1024 });
            return f;
        };
        const video = createFakeVideo();
        const first = mount(video, "r2");
        first.pick(clipOf(100));
        await settle();
        expect(video.createUploads).toHaveLength(1);
        cleanup();

        const second = createFakeVideo();
        const m2 = mount(second, "r2");
        m2.pick(clipOf(201));
        await settle();
        expect(second.createUploads).toEqual([]);
        expect(errorText()).toMatch(/200 MB/);
    });

    it("a host that sets an r2 limit has r2 refuse a clip over it, naming the limit; stream does not apply that limit", async () => {
        const big = new File(["x"], "big.mp4", { type: "video/mp4" });
        Object.defineProperty(big, "size", { value: 65 * 1024 * 1024 });

        const r2 = createFakeVideo({ maxUploadBytes: { r2: 64 * 1024 * 1024 } });
        const first = mount(r2, "r2");
        first.pick(big);
        await settle();
        expect(r2.createUploads).toEqual([]);
        expect(errorText()).toMatch(/64 MB/);
        cleanup();

        const stream = createFakeVideo();
        const second = mount(stream, "stream");
        second.pick(big);
        await settle();
        expect(stream.createUploads).toHaveLength(1);
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
