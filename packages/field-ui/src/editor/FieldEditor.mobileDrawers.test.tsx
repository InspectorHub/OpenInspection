// @vitest-environment happy-dom
/**
 * The phone's bottom drawers reuse the desktop's section rail and side rail. In a drawer the rail fills the sheet (the
 * desktop's fixed 200px column left names truncated and the right side empty), the Preview drawer opens on its panel
 * (the closed state showed only a 44px tab strip), and the app bar names Inspection Details when that view is open.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { m } from "../i18n";
import { mount } from "./FieldEditor.capabilities.fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tab = (label: string) => screen.findByRole("button", { name: new RegExp(`${label}$`) });
const aside = (root: Element) => root.querySelector("aside[data-shortcut-scope]") as HTMLElement;

describe("mobile drawers", () => {
  it("the Sections drawer's rail fills the sheet instead of a fixed 200px column", async () => {
    mount(null, true);
    fireEvent.click(await tab(m.editor_mobile_drawer_sections()));
    const sheet = await screen.findByRole("dialog", { name: m.editor_route_drawer_sections() });
    expect(aside(sheet).className).toContain("w-full");
    expect(aside(sheet).className).not.toContain("w-[200px]");
  });

  it("CONTROL - the desktop rail keeps its 200px column", async () => {
    mount(null, false, undefined, 1440);
    await screen.findByTestId("inspection-details-entry");
    expect(aside(document.documentElement).className).toContain("w-[200px]");
  });

  it("the Preview drawer opens on its panel and the panel fills the sheet", async () => {
    mount(null, true);
    fireEvent.click(await tab(m.editor_route_drawer_preview()));
    const sheet = await screen.findByRole("dialog", { name: m.editor_route_drawer_preview() });
    const panel = sheet.querySelector("div.border-l.flex-col") as HTMLElement;
    expect(panel.className).toContain("flex-1");
    expect(panel.className).not.toContain("w-64");
    // The drawer's own close dismisses it: the panel offers no collapse control, so reopening can never show an empty sheet.
    expect(within(sheet).queryByRole("button", { name: m.editor_siderail_close_panel() })).toBeNull();
  });

  it("CONTROL - on the desktop the side rail starts closed", async () => {
    mount(null, false, undefined, 1440);
    await screen.findByTestId("inspection-details-entry");
    expect(screen.queryByRole("button", { name: m.editor_siderail_close_panel() })).toBeNull();
  });

  it("the app bar names Inspection Details while that view is open, and the item label otherwise", async () => {
    mount(null, true);
    const title = await screen.findByTestId("app-bar-title");
    expect(title.textContent).toContain(m.editor_route_select_an_item());
    expect(title.textContent).not.toContain(m.editor_shared_inspection_details());
    fireEvent.click(await tab(m.editor_mobile_drawer_sections()));
    fireEvent.click(await screen.findByTestId("inspection-details-entry"));
    const after = await screen.findByTestId("app-bar-title");
    expect(after.textContent).toContain(m.editor_shared_inspection_details());
    expect(after.textContent).not.toContain(m.editor_route_select_an_item());
  });
});

// The Preview sheet must never scroll sideways. The tab strip is 44px and the panel takes the rest of the sheet; the
// panel clips (overflow-hidden, min-w-0 so a wide child cannot widen it) and its scroller and the drawer's own scroller
// scroll vertically only.
describe("mobile drawers never scroll sideways", () => {
  it("the Preview sheet's panel, its scroller and the drawer's scroller all clip the x axis", async () => {
    mount(null, true);
    fireEvent.click(await tab(m.editor_route_drawer_preview()));
    const sheet = await screen.findByRole("dialog", { name: m.editor_route_drawer_preview() });
    const panel = sheet.querySelector("div.border-l.flex-col") as HTMLElement;
    expect(panel.className).toContain("min-w-0");
    expect(panel.className).toContain("overflow-hidden");
    expect((panel.querySelector("div.overflow-y-auto") as HTMLElement).className).toContain("overflow-x-hidden");
    expect((sheet.querySelector("div.flex-1.overflow-y-auto") as HTMLElement).className).toContain("overflow-x-hidden");
  });

  it("CONTROL - the desktop panel keeps its fixed width and does not clip its scroller sideways", async () => {
    mount(null, false, undefined, 1440);
    await screen.findByTestId("inspection-details-entry");
    fireEvent.click(document.querySelector("div.w-11 button") as HTMLElement); // the first tab is Preview
    const panel = document.querySelector("div.border-l.flex-col.w-64") as HTMLElement;
    expect(panel).toBeTruthy();
    expect((panel.querySelector("div.overflow-y-auto") as HTMLElement).className).not.toContain("overflow-x-hidden");
  });
});

describe("the Theme drawer", () => {
  it("gives the host's theme buttons a 44px touch target", async () => {
    mount(null, true);
    fireEvent.click(await screen.findByRole("button", { name: m.editor_mobile_more() }));
    const more = await screen.findByRole("dialog", { name: m.editor_mobile_more() });
    fireEvent.click(within(more).getByRole("button", { name: m.nav_theme_label() }));
    const drawer = await screen.findByRole("dialog", { name: m.nav_theme_label() });
    const wrapper = within(drawer).getByTestId("theme-control").parentElement as HTMLElement;
    expect(wrapper.className).toContain("[&_button]:min-h-11");
    expect(wrapper.className).toContain("[&_button]:min-w-11");
  });
});

describe("the phone Items drawer", () => {
  it("lists the items across the whole sheet, not in the desktop's 280px column", async () => {
    mount(null, true);
    fireEvent.click(await tab(m.editor_mobile_drawer_items()));
    const sheet = await screen.findByRole("dialog", { name: m.editor_route_drawer_items() });
    const list = sheet.querySelector("[data-shortcut-scope]") as HTMLElement;
    expect(list.className).toContain("w-full");
    expect(Array.from(sheet.querySelectorAll("*")).some((el) => el.classList.contains("w-[280px]"))).toBe(false);
  });
});
