// @vitest-environment happy-dom
/**
 * Photo batches with a failing step. The host's media store may reject a file (unsupported type, too large, blocked,
 * write failure) and the doc append may throw after a store; the editor treats both as opaque, keeps going with the
 * rest of the batch, and says so once per batch with a count. It is not a save failure, so the save-failed toast
 * never appears. A baking step that rejects falls back to the original file instead of dropping the photo.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type * as Y from "yjs";
import { readResultMap } from "../collab/results-binding";
import { FieldDataSourceProvider } from "../context";
import type { FieldDataSource } from "../data-source";
import { m } from "../i18n";
import { ORIGINAL_QUALITY_KEY } from "../shared/original-quality";
import { createFakeDataSource } from "../testing/fake-data-source";
import { DATA, fullResources, fullSlots, stubCamera, stubViewport } from "./FieldEditor.capabilities.fixtures";
import { FieldEditor } from "./FieldEditor";

const hooks = vi.hoisted(() => ({ appendCalls: 0, appendFailsOn: new Set<number>(), appendCode: "", bakeFails: new Set<string>(), baked: [] as string[], frames: 2 }));

vi.mock("../collab/results-binding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../collab/results-binding")>();
  return {
    ...actual,
    appendPendingPhoto: (...args: Parameters<typeof actual.appendPendingPhoto>) => {
      hooks.appendCalls += 1;
      if (hooks.appendFailsOn.has(hooks.appendCalls)) throw Object.assign(new Error("DOC_DESTROYED"), hooks.appendCode ? { code: hooks.appendCode } : {});
      actual.appendPendingPhoto(...args);
    },
  };
});
vi.mock("../components/media-studio/preprocessImage", () => ({
  preprocessImage: async (file: File) => {
    if (hooks.bakeFails.has(file.name)) throw new Error("CANVAS");
    hooks.baked.push(file.name);
    return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], `baked-${file.name}`, { type: "image/jpeg" });
  },
}));
vi.mock("../components/editor/BurstCamera", () => ({
  BurstCamera: ({ onCommit }: { onCommit: (blobs: Blob[]) => void }) => (
    <button data-testid="burst-commit" onClick={() => onCommit(Array.from({ length: hooks.frames }, () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" })))} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
  localStorage.removeItem(ORIGINAL_QUALITY_KEY);
  hooks.appendCalls = 0;
  hooks.appendFailsOn.clear();
  hooks.appendCode = "";
  hooks.bakeFails.clear();
  hooks.baked.length = 0;
});

type Photo = { pendingId?: string; pendingUpload?: boolean };
const FK = "_default:s1:i1";
const nameOf = (rec: { blob: Blob }) => (rec.blob as File).name;

interface Options {
  /** Opt into original quality (no baking); the default. Files whose name starts with "bad" are rejected by the store. */
  original?: boolean;
  /** `store.delete` throws. */
  deleteThrows?: boolean;
  online?: boolean;
  rejectCode?: string;
}

/** A phone editor on one item whose host store can be made to fail; returns what the editor did. */
async function mountEditor(opts: Options = {}) {
  if (opts.original ?? true) localStorage.setItem(ORIGINAL_QUALITY_KEY, "1");
  stubViewport(true);
  stubCamera(true);
  const fake = createFakeDataSource({ data: DATA, session: { collabEditing: true, tenantSlug: null }, resources: fullResources(), online: opts.online ?? false });
  let doc: Y.Doc | null = null;
  const deleted: string[] = [];
  const ds: FieldDataSource = {
    ...fake,
    collab: {
      ...fake.collab,
      connect: (id, o) => {
        const handle = fake.collab.connect(id, o);
        doc = handle.doc;
        return handle;
      },
    },
    media: {
      ...fake.media,
      store: {
        ...fake.media.store,
        put: async (rec) => {
          if (nameOf(rec).startsWith("bad")) throw Object.assign(new Error("private path must not be shown"), { code: opts.rejectCode ?? "TOO_LARGE" });
          if (nameOf(rec).startsWith("unsupported")) throw Object.assign(new Error("private path must not be shown"), { code: "UNSUPPORTED_TYPE" });
          await fake.media.store.put(rec);
        },
        delete: async (id) => {
          deleted.push(id);
          if (opts.deleteThrows) throw new Error("DELETE_BLOCKED");
          await fake.media.store.delete(id);
        },
      },
    },
  };
  render(
    <FieldDataSourceProvider dataSource={ds} slots={fullSlots()}>
      <FieldEditor data={DATA} />
    </FieldDataSourceProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${m.editor_mobile_drawer_items()}$`) }));
  fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
  await screen.findByRole("button", { name: m.editor_item_open_library() });
  await waitFor(() => expect(doc).not.toBeNull());
  const snapshot = async (unhandled: unknown[]) => {
    const photos = (readResultMap(doc as unknown as Y.Doc)[FK] as { photos?: Photo[] } | undefined)?.photos ?? [];
    const stored = await fake.media.store.list();
    return { fake, photos, stored, unhandled, deleted, messages: fake.notifications.map((x) => x.message), sent: fake.notifications };
  };
  return { fake, snapshot };
}

/** Picks the named files from the library input and waits for the batch to settle. */
async function pick(names: string[], opts: Options = {}) {
  const unhandled: unknown[] = [];
  const onRejection = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onRejection);
  try {
    const { snapshot } = await mountEditor(opts);
    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: names.map((n) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], n, { type: "image/jpeg" })) } });
    await new Promise((r) => setTimeout(r, 150));
    return await snapshot(unhandled);
  } finally {
    process.off("unhandledRejection", onRejection);
  }
}

describe("offline photo batch with a rejecting store", () => {
  it("a rejected middle file is skipped: the others are stored and appended, one notice, nothing unhandled", async () => {
    const out = await pick(["a.jpg", "bad.jpg", "c.jpg"]);
    expect(out.unhandled).toEqual([]);
    expect(out.stored).toHaveLength(2);
    expect(out.photos).toHaveLength(2);
    expect(out.photos.every((p) => p.pendingUpload === true)).toBe(true);
    expect(out.photos.map((p) => p.pendingId).sort()).toEqual(out.stored.map((r) => r.pendingId).sort());
    expect(out.sent).toEqual([
      expect.objectContaining({ message: m.editor_route_photos_partial_added({ success: 2, total: 3, failed: 1 }), variant: "error" }),
      expect.objectContaining({ message: m.editor_route_photo_too_large_single(), variant: "error" }),
    ]);
    expect(out.messages.join(" ")).not.toContain("private path");
    expect(out.messages).not.toContain(m.editor_route_save_failed());
  });

  it("every file rejected: one notice with the count and nothing appended", async () => {
    const out = await pick(["bad1.jpg", "bad2.jpg", "bad3.jpg"]);
    expect(out.unhandled).toEqual([]);
    expect(out.stored).toHaveLength(0);
    expect(out.photos).toHaveLength(0);
    expect(out.messages).toEqual([m.editor_route_photo_too_large({ count: 3, s: "s" })]);
  });

  it("CONTROL - a batch where every file succeeds stores and appends all of them and shows no notice", async () => {
    const out = await pick(["a.jpg", "b.jpg", "c.jpg"]);
    expect(out.unhandled).toEqual([]);
    expect(out.stored).toHaveLength(3);
    expect(out.photos).toHaveLength(3);
    expect(out.sent).toEqual([]);
    expect(out.deleted).toEqual([]);
  });

  it("more files than one batch holds, some rejected: the rejected notice and the capped notice both show", async () => {
    const names = ["bad1.jpg", ...Array.from({ length: 21 }, (_, i) => `ok${i}.jpg`)];
    const out = await pick(names);
    expect(out.unhandled).toEqual([]);
    expect(out.stored).toHaveLength(19);
    expect(out.photos).toHaveLength(19);
    expect(out.messages).toHaveLength(3);
    expect(out.messages).toContain(m.editor_route_photos_partial_added({ success: 19, total: 20, failed: 1 }));
    expect(out.messages).toContain(m.editor_route_photo_too_large_single());
    expect(out.messages).toContain(m.editor_route_photos_batch_capped());
  });
});

describe("offline photo batch when the doc append throws after the store", () => {
  it("the failed file's row is removed, the others are stored and appended, one notice with count 1", async () => {
    hooks.appendFailsOn.add(2);
    const out = await pick(["a.jpg", "b.jpg", "c.jpg"]);
    expect(out.unhandled).toEqual([]);
    expect(out.stored).toHaveLength(2);
    expect(out.photos).toHaveLength(2);
    expect(out.photos.map((p) => p.pendingId).sort()).toEqual(out.stored.map((r) => r.pendingId).sort());
    expect(out.deleted).toHaveLength(1);
    expect(out.messages).toEqual([m.editor_route_photos_partial_added({ success: 2, total: 3, failed: 1 })]);
  });

  it("the cleanup delete throws too: nothing is thrown, the count is still right and the rest is kept", async () => {
    hooks.appendFailsOn.add(2);
    const out = await pick(["a.jpg", "b.jpg", "c.jpg"], { deleteThrows: true });
    expect(out.unhandled).toEqual([]);
    expect(out.deleted).toHaveLength(1);
    expect(out.photos).toHaveLength(2);
    expect(out.messages).toEqual([m.editor_route_photos_partial_added({ success: 2, total: 3, failed: 1 })]);
  });

  it("shows a fixed unsupported-type reason for a coded offline store rejection", async () => {
    const out = await pick(["unsupported.tiff", "ok.jpg"]);
    expect(out.stored).toHaveLength(1);
    expect(out.photos).toHaveLength(1);
    expect(out.messages).toEqual([
      m.editor_route_photos_partial_added({ success: 1, total: 2, failed: 1 }),
      m.editor_route_photo_unsupported_type({ count: 1, s: "" }),
    ]);
    expect(out.messages.join(" ")).not.toContain("private path");
  });

  it("reports each known reason once while keeping valid files from the same batch", async () => {
    const out = await pick(["bad.jpg", "unsupported.tiff", "ok.jpg"]);
    expect(out.stored).toHaveLength(1);
    expect(out.photos).toHaveLength(1);
    expect(out.messages).toEqual([
      m.editor_route_photos_partial_added({ success: 1, total: 3, failed: 2 }),
      m.editor_route_photo_unsupported_type({ count: 1, s: "" }),
      m.editor_route_photo_too_large_single(),
    ]);
  });

  it("a coded error from the doc append is an unknown rejection, not a store reason", async () => {
    hooks.appendFailsOn.add(1);
    hooks.appendCode = "TOO_LARGE";
    const out = await pick(["a.jpg", "b.jpg"]);
    expect(out.messages).toEqual([m.editor_route_photos_partial_added({ success: 1, total: 2, failed: 1 })]);
    expect(out.messages).not.toContain(m.editor_route_photo_too_large_single());
    expect(out.deleted).toHaveLength(1);
  });

  it("CONTROL - the same code from the store itself is explained", async () => {
    const out = await pick(["bad.jpg", "b.jpg"]);
    expect(out.messages).toContain(m.editor_route_photo_too_large_single());
  });

  it("keeps the generic count for an unknown rejection without exposing its message", async () => {
    const out = await pick(["bad.jpg", "ok.jpg"], { rejectCode: "UNRECOGNIZED" });
    expect(out.messages).toEqual([m.editor_route_photos_partial_added({ success: 1, total: 2, failed: 1 })]);
    expect(out.messages.join(" ")).not.toContain("private path");
  });
});

describe("a baking step that rejects falls back to the original file", () => {
  it("offline picker: all three files are stored, the failing one as its original, and no notice shows", async () => {
    hooks.bakeFails.add("b.jpg");
    const out = await pick(["a.jpg", "b.jpg", "c.jpg"], { original: false });
    expect(out.unhandled).toEqual([]);
    expect(out.stored).toHaveLength(3);
    expect(out.photos).toHaveLength(3);
    expect(out.stored.map((r) => nameOf(r)).sort()).toEqual(["b.jpg", "baked-a.jpg", "baked-c.jpg"]);
    expect(out.sent).toEqual([]);
  });

  it("online picker: all three files are handed to the uploader, the failing one as its original", async () => {
    hooks.bakeFails.add("b.jpg");
    const { fake } = await mountEditor({ original: false, online: true });
    fireEvent.change(document.querySelector('input[type="file"][multiple]') as HTMLInputElement, {
      target: { files: ["a.jpg", "b.jpg", "c.jpg"].map((n) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], n, { type: "image/jpeg" })) },
    });
    await waitFor(() => expect(fake.uploads).toHaveLength(3));
    expect(fake.uploads.map((u) => nameOf(u.rec)).sort()).toEqual(["b.jpg", "baked-a.jpg", "baked-c.jpg"]);
  });

  it("burst commit: all three frames are uploaded, the failing one as its original", async () => {
    hooks.bakeFails.add("burst-2.jpg");
    hooks.frames = 3;
    const { fake } = await mountEditor({ original: false, online: true });
    fireEvent.click(await screen.findByRole("button", { name: m.editor_mobile_more() }));
    fireEvent.click(await screen.findByRole("button", { name: m.editor_mobile_burst_camera() }));
    fireEvent.click(screen.getByTestId("burst-commit"));
    await waitFor(() => expect(fake.uploads).toHaveLength(3));
    expect(fake.uploads.map((u) => nameOf(u.rec)).sort()).toEqual(["baked-burst-1.jpg", "baked-burst-3.jpg", "burst-2.jpg"]);
  });

  it("CONTROL - nothing rejects: every file is baked", async () => {
    const out = await pick(["a.jpg", "b.jpg", "c.jpg"], { original: false });
    expect(out.stored.map((r) => nameOf(r)).sort()).toEqual(["baked-a.jpg", "baked-b.jpg", "baked-c.jpg"]);
    expect(hooks.baked).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(out.sent).toEqual([]);
  });
});
