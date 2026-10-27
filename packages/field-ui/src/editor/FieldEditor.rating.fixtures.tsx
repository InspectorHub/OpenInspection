/**
 * Fixtures for the rating-entry parity tests: an inspection with four unrated items and three rating levels, and a
 * mount that hands back the live results document so a test can read what each entry wrote. Not a test file.
 */
import { render } from "@testing-library/react";
import type * as Y from "yjs";
import { FieldDataSourceProvider } from "../context";
import type { EditorData, FieldDataSource, FieldResources } from "../data-source";
import { createEmptyEditorData, createFakeDataSource } from "../testing/fake-data-source";
import { FieldEditor } from "./FieldEditor";
import { stubCamera, stubViewport } from "./FieldEditor.capabilities.fixtures";

export const RATING_DATA: EditorData = createEmptyEditorData({
  inspection: { id: "insp-1", propertyAddress: "1 Main St", propertyType: "residential" },
  resultId: "res-1",
  schema: {
    sections: [
      {
        id: "s1",
        title: "Roofing",
        items: [
          { id: "i1", label: "Flashing condition", type: "rich" },
          { id: "i2", label: "Gutter condition", type: "rich" },
          { id: "i3", label: "Chimney cap", type: "rich" },
          { id: "i4", label: "Skylight seal", type: "rich" },
        ],
      },
    ],
  },
  ratingLevels: [
    { id: "ok", label: "Satisfactory", color: "#0a0", severity: "good" },
    { id: "mon", label: "Monitor", color: "#aa0", severity: "marginal" },
    { id: "def", label: "Defect", color: "#a00", severity: "significant", isDefect: true },
  ],
});

export interface RatingMount {
  fake: ReturnType<typeof createFakeDataSource>;
  /** The live results document, once the editor has connected it. */
  doc: () => Y.Doc;
}

export interface RatingMountOptions {
  platform?: FieldDataSource["platform"];
  data?: EditorData;
  resources?: Partial<FieldResources>;
  readOnly?: boolean;
}

/** Mounts the editor at `width` (390 phone, 834 tablet, 1280 desktop) and captures the results document it connects. */
export function mountForRatings(width: number, { platform = "web", data = RATING_DATA, resources, readOnly }: RatingMountOptions = {}): RatingMount {
  stubViewport(width);
  stubCamera(true);
  const fake = createFakeDataSource({ data, session: { collabEditing: true, tenantSlug: null }, platform, resources });
  let doc: Y.Doc | null = null;
  const connect = fake.collab.connect.bind(fake.collab);
  fake.collab.connect = (id, opts) => {
    const c = connect(id, opts);
    doc = c.doc;
    return c;
  };
  render(
    <FieldDataSourceProvider dataSource={fake} slots={{ humanCheck: "not-required", renderUnsavedGuard: () => <div data-testid="unsaved-guard" /> }}>
      <FieldEditor data={data} readOnly={readOnly} />
    </FieldDataSourceProvider>,
  );
  return {
    fake,
    doc: () => {
      if (!doc) throw new Error("the editor has not connected its results document");
      return doc;
    },
  };
}
