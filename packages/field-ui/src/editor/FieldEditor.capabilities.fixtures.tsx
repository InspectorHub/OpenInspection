/**
 * Fixtures for `FieldEditor.capabilities.test.tsx`: the inspections it opens, the fully provided host, and the
 * mount that leaves one capability out. Not a test file.
 */
import { render } from "@testing-library/react";
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

export function stubViewport(mobile: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: mobile && query.includes("max-width: 767"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }));
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

export type ResourceKey = "aiAssist" | "commentsLibrary" | "costItems" | "mediaPool" | "repairItems" | "settingsSheet" | "templateSearch" | "versionHistory" | "video";
export type SlotKey = "renderThemeControl" | "pdf";
export type Absent = ResourceKey | SlotKey;

function fullResources(): FieldResources {
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
  };
}

export const ALL_OMITS: readonly Absent[] = [
  "aiAssist", "commentsLibrary", "costItems", "mediaPool", "repairItems", "settingsSheet", "templateSearch", "versionHistory", "video",
  "renderThemeControl", "pdf",
];

/** An inspection with no sections yet: the editor then offers to choose a template. */
export const EMPTY_TEMPLATE_DATA: EditorData = createEmptyEditorData({ ...DATA, schema: { sections: [] } });
/** The item carries one video clip, so its viewer has a toolbar with a poster-frame action. */
export const VIDEO_DATA: EditorData = createEmptyEditorData({
  ...DATA,
  results: { "_default:s1:i1": { photos: [{ key: "", mediaType: "video", streamUid: "uid-1" }] } },
});

export function mount(omit: Absent | null, phone: boolean, data: EditorData = DATA) {
  stubViewport(phone);
  const resources = fullResources();
  const slots = fullSlots();
  if (omit === "renderThemeControl" || omit === "pdf") delete slots[omit];
  else if (omit !== null) delete resources[omit];
  const fake = createFakeDataSource({ data, session: { collabEditing: true, tenantSlug: null }, resources });
  render(
    <FieldDataSourceProvider dataSource={fake} slots={slots}>
      <FieldEditor data={data} />
    </FieldDataSourceProvider>,
  );
  return fake;
}
