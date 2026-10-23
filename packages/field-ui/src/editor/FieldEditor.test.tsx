// @vitest-environment happy-dom
/**
 * The editor page on a fake data source: it mounts and lists the template's items, and the two actions that used
 * to reach for browser globals (a template change, the report preview) go through the data source, with a notice
 * when the host does not offer the member.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen, waitFor, fireEvent } from "@testing-library/react";
import { FieldDataSourceProvider } from "../context";
import type { EditorData } from "../data-source";
import type { SettingsSheetData } from "../data-source-types";
import { m } from "../i18n";
import { createEmptyEditorData, createFakeDataSource, createFakeSettingsSheet } from "../testing/fake-data-source";
import type { FakeDataSource, FakeSeed } from "../testing/fake-data-source";
import { FieldEditor } from "./FieldEditor";

function stubViewport(mobile: boolean) {
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

beforeEach(() => stubViewport(false));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DATA: EditorData = createEmptyEditorData({
  schema: { sections: [{ id: "s1", title: "Roofing", items: [{ id: "i1", label: "Flashing condition", type: "rich" }] }] },
  templateSnapshot: { schemaVersion: 2, sections: [] },
  ratingLevels: [{ id: "ok", label: "Satisfactory", color: "#0a0" }],
});

const SHEET: SettingsSheetData = {
  inspection: { templateId: "t1", requireDefectFieldsOverride: "", profileOverride: "", coverPhotoId: null },
  templates: [{ id: "t1", name: "Full" }, { id: "t2", name: "Condo" }],
  photos: [],
  profiles: [],
};

function mount(seed: Partial<FakeSeed> = {}): FakeDataSource {
  const fake = createFakeDataSource({
    data: DATA,
    session: { tenantSlug: "acme" },
    urls: { reportPreview: (slug, id) => `/report-preview/${slug}/${id}` },
    resources: { settingsSheet: createFakeSettingsSheet(SHEET) },
    ...seed,
  });
  render(
    <FieldDataSourceProvider dataSource={fake}>
      <FieldEditor data={DATA} />
    </FieldDataSourceProvider>,
  );
  return fake;
}

async function openMoreActions() {
  fireEvent.click(await screen.findByRole("button", { name: m.editor_mobile_more() }));
}

async function applyTemplateChange() {
  fireEvent.click(await screen.findByText(m.editor_header_settings()));
  await waitFor(() => expect(document.getElementById("inspection-settings-form")).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Full" }));
  fireEvent.click(await screen.findByRole("button", { name: "Condo" }));
  fireEvent.submit(document.getElementById("inspection-settings-form") as HTMLFormElement);
}

describe("FieldEditor", () => {
  it("mounts on the fake data source and shows the template's item", async () => {
    mount();
    expect(await screen.findAllByText("Flashing condition")).not.toHaveLength(0);
  });

  describe("on a phone", () => {
    beforeEach(() => stubViewport(true));

    it("opens the report preview through dataSource.openUrl, and never touches window.open", async () => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const fake = mount();
      await openMoreActions();
      fireEvent.click(await screen.findByText(m.editor_header_preview_report()));
      expect(fake.openedUrls).toEqual(["/report-preview/acme/insp-1"]);
      expect(open).not.toHaveBeenCalled();
    });

    it("tells the person when the host cannot open the preview, instead of doing nothing", async () => {
      const fake = mount({ without: ["openUrl"] });
      await openMoreActions();
      fireEvent.click(await screen.findByText(m.editor_header_preview_report()));
      expect(fake.openedUrls).toEqual([]);
      expect(fake.notifications.map((n) => n.message)).toContain(m.editor_open_url_unavailable());
    });

    it("restarts the session after a template change, not just a data reload", async () => {
      const fake = mount();
      await openMoreActions();
      await applyTemplateChange();
      await waitFor(() => expect(fake.restartCount).toBe(1));
      expect(fake.reloadCount).toBe(0);
    });

    it("asks the person to reopen the inspection when the host cannot restart", async () => {
      const fake = mount({ without: ["restartSession"] });
      await openMoreActions();
      await applyTemplateChange();
      await waitFor(() => expect(fake.notifications.map((n) => n.message)).toContain(m.editor_template_applied_reopen()));
      expect(fake.restartCount).toBe(0);
    });
  });
});
