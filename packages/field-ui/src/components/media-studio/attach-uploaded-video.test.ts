import { describe, expect, it, vi } from "vitest";
import { attachUploadedVideo, videoEntryFrom } from "./attach-uploaded-video";
import type { VideoEntry } from "../../shared/results-doc";

describe("videoEntryFrom", () => {
  it("an R2 clip is addressed by its pool row id, keyless, with its poster and length", () => {
    expect(videoEntryFrom({ provider: "r2", poolId: "pool-1", posterKey: "poster-1", durationSec: 12.5 })).toEqual({
      key: "",
      mediaType: "video",
      provider: "r2",
      mediaId: "pool-1",
      posterKey: "poster-1",
      durationSec: 12.5,
    });
  });

  it("optional fields that were not read are left off, not set to undefined", () => {
    const entry = videoEntryFrom({ provider: "r2", poolId: "pool-1" });
    expect(Object.keys(entry ?? {}).sort()).toEqual(["key", "mediaId", "mediaType", "provider"]);
  });

  it("a Stream clip is addressed by its stream uid", () => {
    expect(videoEntryFrom({ provider: "stream", poolId: "pool-9", streamUid: "uid-1", durationSec: 8 })).toEqual({
      key: "",
      mediaType: "video",
      provider: "stream",
      streamUid: "uid-1",
      durationSec: 8,
    });
  });

  it("an empty pool id means the upload was queued on the device: there is nothing to attach yet", () => {
    expect(videoEntryFrom({ provider: "r2", poolId: "" })).toBeNull();
    expect(videoEntryFrom({ provider: "stream", poolId: "", streamUid: "uid-1" })).toBeNull();
  });
});

function deps(written: boolean) {
  const added: Array<{ itemId: string; entry: VideoEntry }> = [];
  return {
    added,
    notify: vi.fn(),
    reload: vi.fn(),
    addVideoToItem: (itemId: string, entry: VideoEntry) => {
      added.push({ itemId, entry });
      return written;
    },
  };
}

describe("attachUploadedVideo", () => {
  it("puts the clip on the item the upload was started from and says it was added", () => {
    const d = deps(true);
    attachUploadedVideo({ provider: "r2", poolId: "pool-1" }, "item-7", d);
    expect(d.added).toHaveLength(1);
    expect(d.added[0]?.itemId).toBe("item-7");
    expect(d.notify).toHaveBeenCalledWith(expect.stringMatching(/video added/i), "success");
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("when the document would not take the clip it says so as an error and refreshes: it never claims success", () => {
    const d = deps(false);
    attachUploadedVideo({ provider: "r2", poolId: "pool-1" }, "item-7", d);
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.notify).toHaveBeenCalledWith(expect.stringMatching(/could not be added/i), "error", expect.objectContaining({ durationMs: expect.any(Number) }));
    expect(d.notify.mock.calls[0]?.[0]).not.toMatch(/video added/i);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it("a clip with nothing to attach does not write and does not announce success", () => {
    const d = deps(true);
    attachUploadedVideo({ provider: "stream", poolId: "", streamUid: "uid-1" }, "item-7", d);
    expect(d.added).toEqual([]);
    expect(d.notify).not.toHaveBeenCalled();
    expect(d.reload).toHaveBeenCalledTimes(1);
  });
});
