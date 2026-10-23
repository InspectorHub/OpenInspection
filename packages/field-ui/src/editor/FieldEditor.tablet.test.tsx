// @vitest-environment happy-dom
/**
 * The tablet tree (768-1023) and the touch entry points of Speed mode on the phone and tablet: the frame, the top
 * bar and its platform variants, the two panes, the overlays mounted once, and the way into Speed mode in each
 * layout, including a rotation across the breakpoints. What a rating does is in `FieldEditor.rating-parity.test`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createEmptyEditorData } from "../testing/fake-data-source";
import { m } from "../i18n";
import { resizeViewport } from "./FieldEditor.capabilities.fixtures";
import { readResultMap } from "../collab/results-binding";
import { RATING_DATA, mountForRatings } from "./FieldEditor.rating.fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

const bar = () => screen.getByRole("banner");
const list = () => screen.getByTestId("tablet-list-pane");
const pane = () => screen.getByTestId("tablet-editor-pane");
const speedDialog = () => screen.getByRole("dialog", { name: m.editor_speedmode_aria_label() });
const speedTitle = () => within(speedDialog()).getByRole("heading", { level: 2 }).textContent;
const itemsTab = () => screen.findByRole("button", { name: new RegExp(`${m.editor_mobile_drawer_items()}$`) });
const ALL_RATED = createEmptyEditorData({
  ...RATING_DATA,
  results: Object.fromEntries(["i1", "i2", "i3", "i4"].map((id) => [`_default:s1:${id}`, { rating: "ok" }])),
});

describe("tablet tree: frame", () => {
  it("is one dynamic-viewport column with two independent panes and no horizontal overflow rule", async () => {
    mountForRatings(834);
    await screen.findByTestId("tablet-list-pane");
    const root = document.querySelector('[data-layout="tablet"]') as HTMLElement;
    expect(root.className).toContain("h-dvh");
    expect(root.className).toContain("min-w-0");
    expect(root.className).not.toContain("h-screen");
    expect(root.className).not.toContain("overflow-x");
    expect(list().className).toContain("w-[clamp(280px,36vw,360px)]");
    expect(list().className).toContain("min-w-0");
    expect(pane().className).toContain("flex-1");
    expect(pane().className).toContain("min-w-0");
    expect(pane().className).toContain("overflow-y-auto");
    expect(pane().className).toContain("[@media(max-height:499px)]:py-2");
    // The page itself has no 1024px minimum any more.
    expect(document.querySelector(".min-w-\\[1024px\\]")).toBeNull();
  });

  it("the top bar is 56px (48px on a short viewport) and has no bottom tab bar under it", async () => {
    mountForRatings(834);
    await screen.findByTestId("tablet-list-pane");
    expect(bar().className).toContain("h-14");
    expect(bar().className).toContain("[@media(max-height:499px)]:h-12");
    expect(document.querySelector("nav.fixed.bottom-0")).toBeNull();
  });

  it("the section title is pinned above the list, which is the item list of the current section", async () => {
    mountForRatings(834);
    const sub = within(await screen.findByTestId("tablet-list-pane")).getByText("Roofing");
    expect(sub.className).toContain("sticky");
    expect(sub.className).toContain("font-bold");
    expect(within(list()).getAllByText(/condition|cap|seal/)).toHaveLength(4);
  });

  it("with nothing open the right pane offers the first unrated item; opening it shows the editor beside the list, and the row is marked", async () => {
    mountForRatings(834);
    await screen.findByTestId("tablet-list-pane");
    expect(within(pane()).getByText(m.editor_pane_start_title())).toBeTruthy();
    fireEvent.click(within(pane()).getByRole("button", { name: m.editor_pane_open_item({ label: "Flashing condition" }) }));
    await within(pane()).findByRole("radiogroup", { name: m.editor_rating_aria() });
    const row = within(list()).getByText("Flashing condition").closest("[data-sortable-item]") as HTMLElement;
    expect(row.className).toContain("bg-ih-primary-tint");
    expect(row.className).toContain("min-h-14");
    expect(within(list()).getByText("Gutter condition").closest("[data-sortable-item]")!.className).not.toContain("bg-ih-primary-tint");
  });

  it("an empty template shows the template call to action across the body instead of two empty panes", async () => {
    mountForRatings(834, { data: createEmptyEditorData({ ...RATING_DATA, schema: { sections: [] } }) });
    await screen.findByText(m.editor_route_empty_template_title());
    expect(screen.queryByTestId("tablet-list-pane")).toBeNull();
  });
});

describe("tablet tree: top bar controls", () => {
  it("Sections opens the sections drawer, Preview the preview drawer, More the finish drawer", async () => {
    mountForRatings(834);
    await screen.findByTestId("tablet-list-pane");
    fireEvent.click(within(bar()).getByRole("button", { name: m.editor_mobile_drawer_sections() }));
    expect(await screen.findByRole("dialog", { name: m.editor_route_drawer_sections() })).toBeTruthy();
    fireEvent.click(within(bar()).getByRole("button", { name: m.editor_route_drawer_preview() }));
    expect(await screen.findByRole("dialog", { name: m.editor_route_drawer_preview() })).toBeTruthy();
    fireEvent.click(within(bar()).getByRole("button", { name: m.editor_mobile_more() }));
    expect(await screen.findByRole("dialog", { name: m.editor_mobile_more() })).toBeTruthy();
  });

  it("Back leaves the editor through the host's exit (so the unsaved guard runs), also with an item open", async () => {
    const h = mountForRatings(834);
    await screen.findByTestId("tablet-list-pane");
    fireEvent.click(within(list()).getByText("Flashing condition"));
    await within(pane()).findByRole("radiogroup", { name: m.editor_rating_aria() });
    fireEvent.click(within(bar()).getByRole("button", { name: m.common_back() }));
    expect(h.fake.exitCount).toBe(1);
    // The pane did not lose the item first: two panes mean there is no list level to step back to.
    expect(within(pane()).queryByRole("radiogroup", { name: m.editor_rating_aria() })).not.toBeNull();
  });

  it("Publish runs the readiness check once even for two presses in one frame, then opens the publish dialog", async () => {
    let checks = 0;
    mountForRatings(834, { resources: { publishReadiness: { check: async () => { checks += 1; return null; } } } });
    await screen.findByTestId("tablet-list-pane");
    const publish = within(bar()).getByRole("button", { name: m.editor_header_publish() });
    act(() => { publish.click(); publish.click(); });
    expect(await screen.findByRole("dialog", { name: m.editor_publish_title() })).toBeTruthy();
    expect(checks).toBe(1);
  });

  it("the guard, the finish dialogs and the add-media chooser are mounted once", async () => {
    mountForRatings(834);
    await screen.findByTestId("tablet-list-pane");
    expect(screen.getAllByTestId("unsaved-guard")).toHaveLength(1);
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(2);
  });
});

describe("app bar platform", () => {
  it.each([
    ["phone", 390],
    ["tablet", 834],
  ] as const)("%s: the platform of the data source picks the bar", async (_tree, width) => {
    for (const platform of ["web", "ios", "android"] as const) {
      mountForRatings(width, { platform });
      await waitFor(() => expect(screen.getByRole("banner").getAttribute("data-platform")).toBe(platform));
      cleanup();
    }
  });
});

describe("Speed mode entry points", () => {
  it("tablet: the list header says how many are unrated and opens the overlay", async () => {
    mountForRatings(834);
    await screen.findByTestId("tablet-list-pane");
    const entry = within(list()).getByTestId("speed-entry");
    expect(entry.textContent).toBe(m.editor_speed_rate_unrated({ count: 4 }));
    fireEvent.click(entry);
    expect(speedTitle()).toBe("Flashing condition");
    expect(speedDialog().className).toContain("h-dvh");
  });

  it("tablet: the tools dock FAB is there and its Speed mode tile opens the same overlay", async () => {
    mountForRatings(834);
    fireEvent.click(await screen.findByRole("button", { name: m.editor_dock_open() }));
    fireEvent.click(within(await screen.findByRole("menu", { name: m.editor_dock_menu_label() })).getByText(m.editor_dock_speed_mode()));
    expect(speedTitle()).toBe("Flashing condition");
  });

  it("phone: the Items drawer leads with the button and it opens the overlay; there is no dock", async () => {
    mountForRatings(390);
    fireEvent.click(await itemsTab());
    const entry = await screen.findByTestId("speed-entry");
    expect(entry.textContent).toBe(m.editor_speed_rate_unrated({ count: 4 }));
    expect(entry.closest('[role="dialog"]')?.getAttribute("aria-label")).toBe(m.editor_route_drawer_items());
    expect(screen.queryByRole("button", { name: m.editor_dock_open() })).toBeNull();
    fireEvent.click(entry);
    expect(speedTitle()).toBe("Flashing condition");
    expect(speedDialog().className).toContain("pt-[env(safe-area-inset-top)]");
  });

  it("phone: the More drawer has a Speed mode row at the top of Capture", async () => {
    mountForRatings(390);
    fireEvent.click(await screen.findByRole("button", { name: m.editor_mobile_more() }));
    const sheet = await screen.findByRole("dialog", { name: m.editor_mobile_more() });
    const text = sheet.textContent ?? "";
    expect(text.indexOf(m.editor_mobile_group_capture())).toBeLessThan(text.indexOf(m.editor_dock_speed_mode()));
    fireEvent.click(within(sheet).getByRole("button", { name: m.editor_dock_speed_mode() }));
    expect(speedTitle()).toBe("Flashing condition");
  });

  it("every entry is gone when nothing is left to rate, in both layouts", async () => {
    mountForRatings(834, { data: ALL_RATED });
    await screen.findByTestId("tablet-list-pane");
    expect(screen.queryByTestId("speed-entry")).toBeNull();
    cleanup();
    mountForRatings(390, { data: ALL_RATED });
    fireEvent.click(await itemsTab());
    expect(screen.queryByTestId("speed-entry")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: m.editor_mobile_more() }));
    const sheet = await screen.findByRole("dialog", { name: m.editor_mobile_more() });
    expect(within(sheet).queryByRole("button", { name: m.editor_dock_speed_mode() })).toBeNull();
  });

  it("needs no host capability: with no optional resource at all the entries are still there", async () => {
    mountForRatings(834, { resources: {} });
    await screen.findByTestId("tablet-list-pane");
    expect(screen.queryByTestId("speed-entry")).not.toBeNull();
  });

  it("the rating tiles are a bottom row of 56px targets, the title wraps, and the overlay respects both insets", async () => {
    mountForRatings(834);
    fireEvent.click(await screen.findByTestId("speed-entry"));
    const dialog = speedDialog();
    const cls = dialog.className;
    expect(cls).toContain("h-dvh");
    expect(cls).toContain("pt-[env(safe-area-inset-top)]");
    expect(cls).toContain("pb-[max(1rem,env(safe-area-inset-bottom))]");
    const tiles = within(screen.getByTestId("speedmode-ratings")).getAllByRole("button");
    expect(tiles).toHaveLength(3);
    for (const t of tiles) expect(t.className).toContain("min-h-14");
    expect(within(dialog).getByRole("heading", { level: 2 }).className).toContain("line-clamp-2");
  });

  it("a rotation across the breakpoints keeps the overlay, the item and the queue position", async () => {
    mountForRatings(834);
    fireEvent.click(await screen.findByTestId("speed-entry"));
    fireEvent.click(within(speedDialog()).getByRole("button", { name: /Satisfactory/ }));
    await waitFor(() => expect(speedTitle()).toBe("Gutter condition"));
    for (const [width, layout] of [[390, "phone"], [1280, "desktop"], [834, "tablet"]] as const) {
      resizeViewport(width);
      await waitFor(() => expect(document.querySelector(`[data-layout="${layout}"]`)).not.toBeNull());
      expect(speedTitle(), `at ${width}`).toBe("Gutter condition");
      expect(within(speedDialog()).getByText("1 / 3")).toBeTruthy();
    }
  });

  it("the keyboard works in the touch layouts too: Z opens the overlay and Escape closes it", async () => {
    mountForRatings(834);
    await screen.findByTestId("tablet-list-pane");
    fireEvent.keyDown(document.body, { key: "z" });
    expect(speedTitle()).toBe("Flashing condition");
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: m.editor_speedmode_aria_label() })).toBeNull());
  });
});

describe("Speed mode: the last item and the toast", () => {
  const tile = (name: RegExp) => within(speedDialog()).getByRole("button", { name });

  it("rating the last item leaves the overlay up as 'all rated', and its Undo still works", async () => {
    const h = mountForRatings(834);
    fireEvent.click(await screen.findByTestId("speed-entry"));
    for (let i = 0; i < 4; i++) {
      await waitFor(() => expect(within(speedDialog()).getByTestId("speedmode-ratings")).toBeTruthy());
      fireEvent.click(tile(/Defect/));
    }
    await waitFor(() => expect(within(speedDialog()).getByRole("heading", { level: 2 }).textContent).toBe(m.editor_speedmode_all_rated()));
    fireEvent.click(screen.getByRole("button", { name: m.common_undo() }));
    await waitFor(() => expect(speedTitle()).toBe("Skylight seal"));
    expect(readResultMap(h.doc())["_default:s1:i4"]?.rating ?? null).toBeNull();
    expect(readResultMap(h.doc())["_default:s1:i3"]?.rating).toBe("def");
  });

  it("the Undo toast survives a rotation across a breakpoint", async () => {
    mountForRatings(834);
    fireEvent.click(await screen.findByTestId("speed-entry"));
    fireEvent.click(tile(/Defect/));
    expect(screen.getByRole("button", { name: m.common_undo() })).toBeTruthy();
    resizeViewport(390);
    await waitFor(() => expect(document.querySelector('[data-layout="phone"]')).not.toBeNull());
    expect(screen.getByRole("button", { name: m.common_undo() })).toBeTruthy();
  });
});
