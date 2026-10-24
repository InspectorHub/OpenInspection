// @vitest-environment happy-dom
/**
 * Every overlay `SharedOverlays` owns is mounted exactly once in each tree. The overlays are replaced by stand-ins
 * that only mark themselves, so this counts mounts and nothing else. The three overlays the editor mounts only while
 * some state is set (the poster picker, the photo cropper, the cover cropper) are driven by forcing that state on.
 * How the real ones behave once opened is in `FieldEditor.phone.test.tsx`, which does not mock them.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { m } from "../i18n";
import { mount, type Absent } from "./FieldEditor.capabilities.fixtures";

const forced = vi.hoisted(() => ({ on: false }));

vi.mock("../hooks/usePhotoOps", async (importOriginal) => {
  const real = await importOriginal<typeof import("../hooks/usePhotoOps")>();
  return {
    ...real,
    usePhotoOps: (args: Parameters<typeof real.usePhotoOps>[0]) => {
      const ops = real.usePhotoOps(args);
      if (!forced.on) return ops;
      return {
        ...ops,
        posterTarget: { streamUid: "uid-1", durationSec: 1, posterPct: 0 },
        photoCropTarget: { sourceUrl: "https://example.test/p.jpg", hasAnnotation: false },
        galleryCropSource: { url: "https://example.test/p.jpg", key: "k1" },
      };
    },
  };
});

vi.mock("../components/editor/BurstCamera", async () => ({ BurstCamera: (await import("./FieldEditor.overlays.stub")).stub("BurstCamera") }));
vi.mock("../components/media-studio/PhotoAnnotator", async () => ({ PhotoAnnotator: (await import("./FieldEditor.overlays.stub")).stub("PhotoAnnotator") }));
vi.mock("../components/media-studio/MediaViewer", async () => ({ MediaViewer: (await import("./FieldEditor.overlays.stub")).stub("MediaViewer") }));
vi.mock("../components/media-studio/PosterPicker", async () => ({ PosterPicker: (await import("./FieldEditor.overlays.stub")).stub("PosterPicker") }));
vi.mock("../components/media-studio/PhotoCropper", async () => ({ PhotoCropper: (await import("./FieldEditor.overlays.stub")).stub("PhotoCropper") }));
vi.mock("../components/media-studio/CoverCropper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components/media-studio/CoverCropper")>()),
  CoverCropper: (await import("./FieldEditor.overlays.stub")).stub("CoverCropper"),
}));
vi.mock("../components/editor/RecropWarningModal", async () => ({ RecropWarningModal: (await import("./FieldEditor.overlays.stub")).stub("RecropWarningModal") }));
vi.mock("../components/editor/StructureDeleteModal", async () => ({ StructureDeleteModal: (await import("./FieldEditor.overlays.stub")).stub("StructureDeleteModal") }));
vi.mock("../components/editor/AddSectionPromptModal", async () => ({ AddSectionPromptModal: (await import("./FieldEditor.overlays.stub")).stub("AddSectionPromptModal") }));
vi.mock("../components/statutory/AddGroupInstanceHost", async () => ({ AddGroupInstanceHost: (await import("./FieldEditor.overlays.stub")).stub("AddGroupInstanceHost") }));
vi.mock("../components/editor/AddItemTypeModal", async () => ({ AddItemTypeModal: (await import("./FieldEditor.overlays.stub")).stub("AddItemTypeModal") }));
vi.mock("../components/editor/SaveTemplateModal", async () => ({ SaveTemplateModal: (await import("./FieldEditor.overlays.stub")).stub("SaveTemplateModal") }));
vi.mock("../components/collab/VersionHistoryPanel", async () => ({ VersionHistoryPanel: (await import("./FieldEditor.overlays.stub")).stub("VersionHistoryPanel") }));
vi.mock("../components/editor/CommentLibraryDrawer", async () => ({ CommentLibraryDrawer: (await import("./FieldEditor.overlays.stub")).stub("CommentLibraryDrawer") }));
vi.mock("../components/editor/SectionPickerModal", async () => ({ SectionPickerModal: (await import("./FieldEditor.overlays.stub")).stub("SectionPickerModal") }));
vi.mock("../components/editor/TagPickerModal", async () => ({ TagPickerModal: (await import("./FieldEditor.overlays.stub")).stub("TagPickerModal") }));
vi.mock("../components/editor/UnitsManager", async () => ({ UnitsManager: (await import("./FieldEditor.overlays.stub")).stub("UnitsManager") }));
vi.mock("../components/editor/CostItemsHost", async () => ({ CostItemsHost: (await import("./FieldEditor.overlays.stub")).stub("CostItemsHost") }));

/** The eighteen overlays `SharedOverlays` mounts. */
const OVERLAYS = [
  "BurstCamera", "PhotoAnnotator", "MediaViewer", "PosterPicker", "PhotoCropper", "RecropWarningModal",
  "StructureDeleteModal", "AddSectionPromptModal", "AddGroupInstanceHost", "AddItemTypeModal", "SaveTemplateModal",
  "CoverCropper", "VersionHistoryPanel", "CommentLibraryDrawer", "SectionPickerModal", "TagPickerModal",
  "UnitsManager", "CostItemsHost",
] as const;

afterEach(() => {
  cleanup();
  forced.on = false;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

const count = (name: string) => document.querySelectorAll(`[data-overlay="${name}"]`).length;
const ready = (phone: boolean) =>
  screen.findByRole("button", { name: phone ? new RegExp(`${m.editor_mobile_drawer_items()}$`) : m.editor_header_publish() });

describe("shared overlays are mounted once per tree", () => {
  it("lists all eighteen", () => {
    expect(new Set(OVERLAYS).size).toBe(18);
  });

  it.each([["phone", true], ["desktop", false]] as const)("%s: each of the eighteen is mounted exactly once", async (_tree, phone) => {
    forced.on = true;
    mount(null, phone);
    await ready(phone);
    const counts = Object.fromEntries(OVERLAYS.map((n) => [n, count(n)]));
    expect(counts).toEqual(Object.fromEntries(OVERLAYS.map((n) => [n, 1])));
  });

  it.each([["phone", true], ["desktop", false]] as const)("%s: without the state that opens them, the three conditional overlays are not mounted at all", async (_tree, phone) => {
    mount(null, phone);
    await ready(phone);
    for (const n of ["PosterPicker", "PhotoCropper", "CoverCropper"]) expect(count(n), n).toBe(0);
    // The rest stay mounted (they gate themselves on `open`).
    expect(count("MediaViewer")).toBe(1);
  });

  it.each([
    ["phone", "commentsLibrary", "CommentLibraryDrawer", true],
    ["desktop", "commentsLibrary", "CommentLibraryDrawer", false],
    ["phone", "costItems", "CostItemsHost", true],
    ["desktop", "costItems", "CostItemsHost", false],
  ] as const)("%s tree: without %s, %s is not mounted and nothing else disappears", async (_tree, omit, gone, phone) => {
    forced.on = true;
    mount(omit satisfies Absent, phone);
    await ready(phone);
    for (const n of OVERLAYS) expect(count(n), n).toBe(n === gone ? 0 : 1);
  });
});
