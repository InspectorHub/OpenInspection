/**
 * Fixtures for `FieldEditor.capabilities.test.tsx`: the inspections it opens, the fully provided host, and the
 * mount that leaves one capability out. Not a test file.
 */
import { act, render } from "@testing-library/react";
import { vi } from "vitest";
import { FieldDataSourceProvider } from "../context";
import type { EditorData, FieldHostSlots, FieldResources } from "../data-source";
import {
  createEmptyEditorData,
  createFakeAiAssist,
  createFakeCommentsLibrary,
  createFakeCostItems,
  createFakeDataSource,
  createFakeMediaPool,
  createFakeRepairItems,
  createFakeSettingsSheet,
  createFakeTemplateSearch,
  createFakeVersionHistory,
  createFakeVideo,
} from "../testing/fake-data-source";
import { FieldEditor } from "./FieldEditor";

/** The stubbed viewport width. Every `max-width: Npx` query is answered from it, so each band is real. */
let viewportWidth = 1280;
const viewportListeners = new Set<() => void>();
const widthOf = (arg: boolean | number) => (typeof arg === "number" ? arg : arg ? 390 : 1280);

/** `true` is a phone (390), `false` a desktop (1280); a number is that width in px (768-1023 is the tablet band). */
export function stubViewport(arg: boolean | number) {
  viewportWidth = widthOf(arg);
  viewportListeners.clear();
  vi.stubGlobal("matchMedia", (query: string) => {
    const limit = Number(/max-width:\s*([\d.]+)px/.exec(query)?.[1] ?? "-1");
    return {
      get matches() {
        return viewportWidth <= limit;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => viewportListeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => viewportListeners.delete(fn),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    };
  });
}

/** Moves the stubbed viewport and tells every subscriber, as a rotation or a window resize would. */
export function resizeViewport(arg: boolean | number) {
  viewportWidth = widthOf(arg);
  act(() => viewportListeners.forEach((fn) => fn()));
}

// A commercial inspection (the units and cost surfaces are gated by property type), with a result row (the AI panel
// needs an artifact to review) and one rich item that has a canned defect (the repair-items panel lives on that tab).
export const DATA: EditorData = createEmptyEditorData({
  inspection: { id: "insp-1", propertyAddress: "1 Main St", propertyType: "commercial" },
  resultId: "res-1",
  schema: {
    sections: [
      {
        id: "s1",
        title: "Roofing",
        items: [
          {
            id: "i1",
            label: "Flashing condition",
            type: "rich",
            tabs: { defects: [{ id: "d1", title: "Granule loss", comment: "Granule loss at the eave." }] },
          },
        ],
      },
    ],
  },
  ratingLevels: [{ id: "ok", label: "Satisfactory", color: "#0a0" }],
});

type ResourceKey = "aiAssist" | "commentsLibrary" | "costItems" | "mediaPool" | "repairItems" | "settingsSheet" | "templateSearch" | "versionHistory" | "video";
type SlotKey = "renderThemeControl" | "pdf";
/** The device itself: no camera API, as on a plain-http origin or a desktop without one. */
type EnvironmentKey = "cameraCapture";
export type Absent = ResourceKey | SlotKey | EnvironmentKey;

/** Gives the page a camera API (or not). `getUserMedia` calls are counted so a test can tell how many cameras opened. */
export function stubCamera(present: boolean) {
  const calls = { getUserMedia: 0 };
  if (present) {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          calls.getUserMedia += 1;
          return { getTracks: () => [] };
        },
      },
    });
  } else {
    Reflect.deleteProperty(navigator, "mediaDevices");
  }
  return calls;
}

export function fullResources(): FieldResources {
  return {
    aiAssist: createFakeAiAssist(),
    commentsLibrary: createFakeCommentsLibrary(),
    costItems: createFakeCostItems(),
    mediaPool: createFakeMediaPool(),
    repairItems: createFakeRepairItems(),
    settingsSheet: createFakeSettingsSheet({
      inspection: { templateId: "t1", requireDefectFieldsOverride: "", profileOverride: "", coverPhotoId: null },
      templates: [{ id: "t1", name: "Full" }],
      photos: [],
      profiles: [],
    }),
    templateSearch: createFakeTemplateSearch(),
    versionHistory: createFakeVersionHistory(),
    video: createFakeVideo(),
    publishReadiness: { check: async () => null },
  };
}

function fullSlots(): FieldHostSlots {
  return {
    renderThemeControl: () => <div data-testid="theme-control" />,
    pdf: { run: () => {}, busy: false, error: null, actionLabel: (label) => label },
    humanCheck: "not-required",
    // One marker per tree that mounts the guard: a tree that mounted it twice would show two.
    renderUnsavedGuard: () => <div data-testid="unsaved-guard" />,
  };
}

export const ALL_OMITS: readonly Absent[] = [
  "aiAssist", "commentsLibrary", "costItems", "mediaPool", "repairItems", "settingsSheet", "templateSearch", "versionHistory", "video",
  "renderThemeControl", "pdf", "cameraCapture",
];

/** An inspection with no sections yet: the editor then offers to choose a template. */
export const EMPTY_TEMPLATE_DATA: EditorData = createEmptyEditorData({ ...DATA, schema: { sections: [] } });
/** The item carries one video clip, so its viewer has a toolbar with a poster-frame action. */
export const VIDEO_DATA: EditorData = createEmptyEditorData({
  ...DATA,
  results: { "_default:s1:i1": { photos: [{ key: "", mediaType: "video", streamUid: "uid-1" }] } },
});

export function mount(omit: Absent | null, phone: boolean, data: EditorData = DATA, width?: number) {
  stubViewport(width ?? phone);
  const resources = fullResources();
  const slots = fullSlots();
  stubCamera(omit !== "cameraCapture");
  if (omit === "renderThemeControl" || omit === "pdf") delete slots[omit];
  else if (omit !== null && omit !== "cameraCapture") delete resources[omit];
  const fake = createFakeDataSource({ data, session: { collabEditing: true, tenantSlug: null }, resources });
  render(
    <FieldDataSourceProvider dataSource={fake} slots={slots}>
      <FieldEditor data={data} />
    </FieldDataSourceProvider>,
  );
  return fake;
}
