// @vitest-environment happy-dom
/**
 * The editor page on a fake data source: it mounts and lists the template's items, and the action that used
 * to reach for browser globals (the report preview) goes through the data source, with a notice when the
 * host does not offer the member. The template itself is chosen on the inspection's hub page now (#529),
 * so there is no template-change path left in the editor.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { FieldDataSourceProvider } from "../context";
import type { EditorData } from "../data-source";
import { m } from "../i18n";
import { createEmptyEditorData, createFakeDataSource } from "../testing/fake-data-source";
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

function mount(seed: Partial<FakeSeed> = {}): FakeDataSource {
  const fake = createFakeDataSource({
    data: DATA,
    session: { tenantSlug: "acme" },
    urls: { reportPreview: (slug, id) => `/report-preview/${slug}/${id}` },
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

    it("offers no report preview when the host cannot open it, while the rest of the drawer stays", async () => {
      mount({ without: ["openUrl"] });
      await openMoreActions();
      // The drawer is open (Publish is in it), and the preview entry is not.
      await screen.findByRole("button", { name: m.editor_header_publish() });
      expect(screen.queryByText(m.editor_header_preview_report())).toBeNull();
    });
  });
});
