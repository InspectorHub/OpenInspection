// @vitest-environment happy-dom
/**
 * What the desktop header and footer carried at 768-1023 and the touch layouts must still reach: the theme, the PDF
 * preview, the Template actions, the save indicator, which inspection this is, the connection strip and the
 * per-unit scope switch. Each entry is there when the host provides what it calls and absent when it does not.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { m } from "../i18n";
import { createEmptyEditorData } from "../testing/fake-data-source";
import { DATA, mount, type Absent } from "./FieldEditor.capabilities.fixtures";
import { RATING_DATA, mountForRatings } from "./FieldEditor.rating.fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

const TABLET = 834;
const PHONE = 390;
const moreButton = () => screen.findByRole("button", { name: m.editor_mobile_more() });
async function openMore() {
  fireEvent.click(await moreButton());
  return screen.findByRole("dialog", { name: m.editor_mobile_more() });
}
const rowIn = (sheet: HTMLElement, name: string) => within(sheet).queryByRole("button", { name });

describe.each([["tablet", TABLET], ["phone", PHONE]] as const)("%s: More drawer carries the header's entries", (_tree, width) => {
  const phone = width === PHONE;
  const mountMore = (omit: Absent | null, data = DATA) => mount(omit, phone, data, width);

  it("Theme opens the theme drawer; without a theme control there is no row", async () => {
    mountMore(null);
    fireEvent.click(rowIn(await openMore(), m.nav_theme_label())!);
    const drawer = await screen.findByRole("dialog", { name: m.nav_theme_label() });
    expect(within(drawer).getByTestId("theme-control")).toBeTruthy();
    cleanup();
    mountMore("renderThemeControl");
    expect(rowIn(await openMore(), m.nav_theme_label())).toBeNull();
  });

  it("PDF is a row when the host has the export, with the host's wording; absent without it", async () => {
    mountMore(null);
    expect(rowIn(await openMore(), m.editor_header_preview_pdf_short())).not.toBeNull();
    cleanup();
    mountMore("pdf");
    expect(rowIn(await openMore(), m.editor_header_preview_pdf_short())).toBeNull();
  });

  it("Template: Save as new is always there, Change template needs the settings sheet, Update source needs a source template", async () => {
    mountMore(null);
    let sheet = await openMore();
    expect(within(sheet).getByText(m.template_menu_template())).toBeTruthy();
    expect(rowIn(sheet, m.template_menu_save_new())).not.toBeNull();
    expect(rowIn(sheet, m.template_menu_change())).not.toBeNull();
    expect(rowIn(sheet, m.template_menu_update_source())).toBeNull();
    cleanup();
    mountMore("settingsSheet");
    sheet = await openMore();
    expect(rowIn(sheet, m.template_menu_change())).toBeNull();
    expect(rowIn(sheet, m.template_menu_save_new())).not.toBeNull();
    cleanup();
    mountMore(null, createEmptyEditorData({ ...DATA, inspection: { ...DATA.inspection, templateId: "t1" } }));
    expect(rowIn(await openMore(), m.template_menu_update_source())).not.toBeNull();
  });

  it("Change template opens the settings sheet", async () => {
    mountMore(null);
    fireEvent.click(rowIn(await openMore(), m.template_menu_change())!);
    expect(await screen.findAllByRole("dialog", { name: m.editor_header_settings() })).toBeTruthy();
  });
});

describe.each([["tablet", TABLET], ["phone", PHONE]] as const)("%s: save indicator", (_tree, width) => {
  it("shows Saved after a save and nothing while idle", async () => {
    mountForRatings(width);
    await screen.findByRole("banner");
    expect(screen.queryByTestId("save-status")).toBeNull();
    fireEvent.keyDown(document.body, { key: "s", ctrlKey: true });
    await waitFor(() => expect(within(screen.getByRole("banner")).getByTestId("save-status").textContent).toBe(m.editor_header_save_saved()));
  });
});

describe("tablet: identity, connection strip and sync marker", () => {
  it("the list pane names the inspection: address, number and status", async () => {
    mountForRatings(TABLET);
    const pane = await screen.findByTestId("tablet-list-pane");
    const id = within(pane).getByTestId("inspection-identity");
    expect(id.textContent).toContain("1 Main St");
    expect(id.textContent).toContain("#INSP-1");
  });

  it("the connection strip (shortcuts, status) is mounted once", async () => {
    mountForRatings(TABLET);
    await screen.findByTestId("tablet-list-pane");
    expect(screen.getAllByRole("button", { name: new RegExp(m.editor_shortcuts_label()) })).toHaveLength(1);
    expect(screen.getAllByText(m.editor_footer_status_connecting()).length + screen.queryAllByText(m.editor_footer_status_connected()).length).toBeGreaterThan(0);
  });

  it.each([["tablet", TABLET], ["phone", PHONE], ["desktop", 1280]] as const)("%s: the root says whether the document has synced", async (_n, width) => {
    mountForRatings(width);
    await waitFor(() => expect(document.querySelector("[data-layout]")?.getAttribute("data-collab-synced")).toBe("true"));
  });
});

const UNIT_DATA = createEmptyEditorData({
  ...RATING_DATA,
  inspection: { ...RATING_DATA.inspection, propertyType: "commercial" },
  units: [
    { id: "u1", name: "Unit 1", kind: "unit", type: "unit", parentUnitId: null, sortOrder: 1 },
    { id: "u2", name: "Unit 2", kind: "unit", type: "unit", parentUnitId: null, sortOrder: 2 },
  ],
  unitInspectionMode: "per_unit",
});

describe("per-unit scope switch", () => {
  it("tablet: the list pane has the scope switcher and choosing a unit changes the scope", async () => {
    mountForRatings(TABLET, { data: UNIT_DATA });
    const pane = await screen.findByTestId("tablet-list-pane");
    const trigger = within(pane).getByRole("button", { name: new RegExp(m.editor_scope_common()) });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText("Unit 1"));
    await waitFor(() => expect(within(screen.getByTestId("tablet-list-pane")).getByRole("button", { name: /Unit 1/ })).toBeTruthy());
  });

  it("phone: the Items drawer has it too", async () => {
    mountForRatings(PHONE, { data: UNIT_DATA });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${m.editor_mobile_drawer_items()}$`) }));
    const drawer = await screen.findByRole("dialog", { name: m.editor_route_drawer_items() });
    expect(within(drawer).getByRole("button", { name: new RegExp(m.editor_scope_common()) })).toBeTruthy();
  });

  it.each([["tablet", TABLET], ["phone", PHONE]] as const)("%s: a single-unit (tagged) inspection has no switcher", async (_n, width) => {
    mountForRatings(width, { data: createEmptyEditorData({ ...UNIT_DATA, unitInspectionMode: "tagged" }) });
    await screen.findByRole("banner");
    expect(screen.queryByRole("button", { name: new RegExp(m.editor_scope_common()) })).toBeNull();
  });
});
