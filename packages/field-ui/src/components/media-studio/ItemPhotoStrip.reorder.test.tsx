// @vitest-environment happy-dom
/** The order a drag emits names every entry, including clips and pending photos that have no file key. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const hooks: { onEnd?: (e: { oldIndex: number; newIndex: number }) => void } = {};
vi.mock("sortablejs", () => ({
  default: { create: (_el: unknown, opts: { onEnd: (e: { oldIndex: number; newIndex: number }) => void }) => { hooks.onEnd = opts.onEnd; return { destroy: () => {} }; } },
}));
import { ItemPhotoStrip, type StripPhoto } from "./ItemPhotoStrip";

afterEach(cleanup);

function drag(photos: StripPhoto[], oldIndex: number, newIndex: number) {
  const onReorder = vi.fn();
  render(<ItemPhotoStrip inspectionId="i" itemId="it" photos={photos} coverKey={null} photoUrl={(k) => `/p/${k}`} onOpen={() => {}} onReorder={onReorder} videoPosterUrl={() => null} />);
  hooks.onEnd!({ oldIndex, newIndex });
  return onReorder.mock.calls[0]![0] as string[];
}

describe("ItemPhotoStrip reorder order", () => {
  it("names two clips and a photo apart", () => {
    const photos: StripPhoto[] = [
      { key: "", mediaType: "video", provider: "r2", mediaId: "a" },
      { key: "p.jpg" },
      { key: "", mediaType: "video", provider: "r2", mediaId: "b" },
    ];
    expect(drag(photos, 2, 0)).toEqual(["m:b", "m:a", "p.jpg"]);
  });

  it("names a pending photo and a legacy Stream clip", () => {
    const photos: StripPhoto[] = [{ key: "", pendingId: "pend1", pendingUpload: true }, { key: "", mediaType: "video", streamUid: "u1" }];
    expect(drag(photos, 0, 1)).toEqual(["s:u1", "p:pend1"]);
  });

  it("control: photos alone still emit their plain keys", () => {
    expect(drag([{ key: "a" }, { key: "b" }], 0, 1)).toEqual(["b", "a"]);
  });
});
