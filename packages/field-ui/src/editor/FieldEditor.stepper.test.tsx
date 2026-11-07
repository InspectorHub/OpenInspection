// @vitest-environment happy-dom
/**
 * Where the editor opens and how a touch layout moves between items: it opens on the item the person was last on (or the first),
 * and Previous / Next cross section borders in both directions, passing over a section with no items.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { m } from "../i18n";
import { createEmptyEditorData } from "../testing/fake-data-source";
import { mountForRatings, RATING_DATA } from "./FieldEditor.rating.fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

const THREE = createEmptyEditorData({
  ...RATING_DATA,
  schema: {
    sections: [
      { id: "s1", title: "Roofing", items: [{ id: "i1", label: "Flashing condition", type: "rich" }, { id: "i2", label: "Gutter condition", type: "rich" }] },
      { id: "s2", title: "Empty bay", items: [] },
      { id: "s3", title: "Attic", items: [{ id: "i3", label: "Insulation depth", type: "rich" }] },
    ],
  },
});

const title = () => screen.findByTestId("app-bar-title");
const stepper = () => within(screen.getByTestId("item-stepper"));
const prev = () => stepper().getByRole("button", { name: m.editor_hud_nav_prev() });
const next = () => stepper().getByRole("button", { name: m.editor_hud_nav_next() });

describe("the editor opens on an item", () => {
  it("phone: on the first item, with no blank page and no section to find first", async () => {
    mountForRatings(390, { data: THREE });
    expect((await title()).textContent).toContain("Flashing condition");
    expect(screen.queryByText(m.editor_route_mobile_begin())).toBeNull();
  });

  it("phone: Back leaves the editor, because there is no list level to fall back to", async () => {
    const h = mountForRatings(390, { data: THREE });
    await title();
    fireEvent.click(screen.getByRole("button", { name: m.common_back() }));
    expect(h.fake.exitCount).toBe(1);
  });

  it("opens again on the item the person last used in this inspection", async () => {
    mountForRatings(390, { data: THREE });
    await title();
    fireEvent.click(next());
    fireEvent.click(next());
    expect((await title()).textContent).toContain("Insulation depth");
    cleanup();
    mountForRatings(390, { data: THREE });
    expect((await title()).textContent).toContain("Insulation depth");
    expect((await title()).textContent).toContain("Attic");
  });

  it("falls back to the first item when the remembered one is gone", async () => {
    localStorage.setItem("oi:editor:last-item:insp-1", JSON.stringify({ sectionId: "s3", itemId: "removed" }));
    mountForRatings(390, { data: THREE });
    expect((await title()).textContent).toContain("Flashing condition");
  });

  it("the web desktop layout opens on the first item too", async () => {
    mountForRatings(1280, { data: THREE });
    expect(await screen.findByRole("radiogroup", { name: m.editor_rating_aria() })).toBeTruthy();
    expect(screen.queryByText(m.editor_pane_start_title())).toBeNull();
  });
});

describe("Previous / Next item", () => {
  it.each([["phone", 390], ["tablet", 834]] as const)("%s: Next crosses into the next section and Previous comes back to its last item", async (_name, width) => {
    mountForRatings(width, { data: THREE });
    await screen.findByTestId("item-stepper");
    expect(prev()).toBeDisabled();
    expect(stepper().getByText(m.editor_item_position({ n: 1, total: 2 }))).toBeTruthy();
    fireEvent.click(next());
    expect((await title()).textContent).toContain("Gutter condition");
    expect(stepper().getByText(m.editor_item_position({ n: 2, total: 2 }))).toBeTruthy();
    fireEvent.click(next());
    // The empty section is passed over: the next stop is the Attic's only item, and there is nothing after it.
    expect(stepper().getByText(m.editor_item_position({ n: 1, total: 1 }))).toBeTruthy();
    expect(next()).toBeDisabled();
    fireEvent.click(prev());
    expect(stepper().getByText(m.editor_item_position({ n: 2, total: 2 }))).toBeTruthy();
    expect(next()).toBeEnabled();
  });

  it("is not shown on the desktop layout, where the keyboard and the list already move between items", async () => {
    mountForRatings(1280, { data: THREE });
    await screen.findByRole("radiogroup", { name: m.editor_rating_aria() });
    expect(screen.queryByTestId("item-stepper")).toBeNull();
  });

  it("is not shown while Inspection Details is open", async () => {
    mountForRatings(390, { data: THREE });
    await title();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${m.editor_mobile_drawer_sections()}$`) }));
    fireEvent.click(await screen.findByTestId("inspection-details-entry"));
    await screen.findByTestId("property-info-form");
    expect(screen.queryByTestId("item-stepper")).toBeNull();
  });
});
