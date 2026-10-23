// @vitest-environment happy-dom
/**
 * Optional host capabilities: a host that does not provide one must not see its entry point. Not a button that only
 * fails when pressed, not a menu row that opens an empty panel.
 *
 * Each entry point is found the way a person (or another test) finds it: by role and visible name, or by a
 * test id the product already carries. For every entry the test mounts the editor with everything provided (the
 * positive control), then once per omitted capability, and asserts the entry is absent ONLY when its own
 * capability is the omitted one. The "only" half is the control that hiding one entry did not take another with it.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, screen, waitFor, fireEvent, within } from "@testing-library/react";
import type { EditorData } from "../data-source";
import { m } from "../i18n";
import type { FakeCommentsLibrary } from "../testing/fake-data-source";
import { ALL_OMITS, EMPTY_TEMPLATE_DATA, VIDEO_DATA, mount, stubViewport, type Absent } from "./FieldEditor.capabilities.fixtures";

beforeEach(() => stubViewport(false));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Open the item the template offers, through whichever tree is mounted. */
async function openItem(phone: boolean) {
  if (phone) fireEvent.click(await screen.findByRole("button", { name: endsWith(m.editor_mobile_drawer_items()) }));
  const row = (await screen.findAllByText("Flashing condition"))[0];
  fireEvent.click(row);
  await waitFor(() => expect(notesField()).not.toBeNull());
}

/** The notes field, whichever placeholder the editor shows (it names the library only when there is one). */
const notesField = () =>
  screen.queryByPlaceholderText(m.editor_item_notes_placeholder()) ?? screen.queryByPlaceholderText(m.editor_item_notes_placeholder_no_library());

const has = (name: string | RegExp) => screen.queryAllByRole("button", { name }).length > 0;
/** The phone nav buttons carry an icon glyph in front of their label ("≣ Items"), so the label ends the name. */
const endsWith = (label: string) => new RegExp(`${label}$`);

interface Entry {
  name: string;
  /** The capability whose absence must take this entry away. Null: a control that must always be there. */
  cap: Absent | null;
  trees: readonly ("desktop" | "phone")[];
  /** The inspection to open; defaults to the one with an item. */
  data?: EditorData;
  /** Whether the entry point is on screen. Does whatever a person does to reach it. */
  present(phone: boolean): Promise<boolean>;
}

const ENTRIES: Entry[] = [
  // Controls: not capabilities, and they sit next to the entries that are.
  { name: "control: Publish", cap: null, trees: ["desktop"], present: async () => has(m.editor_header_publish()) },
  { name: "control: Units manager", cap: null, trees: ["desktop"], present: async () => has(m.editor_route_units()) },
  {
    name: "control: Save as new template",
    cap: null,
    trees: ["desktop"],
    present: async () => {
      fireEvent.click(screen.getByRole("button", { name: m.template_menu_template() }));
      return screen.queryByTestId("save-template-new-btn") !== null;
    },
  },
  {
    name: "versionHistory: header button",
    cap: "versionHistory",
    trees: ["desktop"],
    present: async () => has(m.editor_header_version_history()),
  },
  {
    name: "versionHistory: More menu row",
    cap: "versionHistory",
    trees: ["desktop"],
    present: async () => {
      fireEvent.click(screen.getByRole("button", { name: m.editor_header_more() }));
      return screen.queryByTestId("overflow-version-history-btn") !== null;
    },
  },
  { name: "costItems: header button", cap: "costItems", trees: ["desktop"], present: async () => has(m.editor_route_cost_items()) },
  { name: "settingsSheet: header button", cap: "settingsSheet", trees: ["desktop"], present: async () => has(m.editor_header_settings()) },
  {
    name: "settingsSheet: Template menu, change template",
    cap: "settingsSheet",
    trees: ["desktop"],
    present: async () => {
      fireEvent.click(screen.getByRole("button", { name: m.template_menu_template() }));
      return screen.queryByTestId("change-template-btn") !== null;
    },
  },
  {
    name: "settingsSheet: phone More drawer",
    cap: "settingsSheet",
    trees: ["phone"],
    present: async () => {
      fireEvent.click(screen.getByRole("button", { name: m.editor_mobile_more() }));
      await screen.findByRole("button", { name: m.editor_header_publish() });
      return has(m.editor_header_settings());
    },
  },
  { name: "commentsLibrary: side rail tab", cap: "commentsLibrary", trees: ["desktop"], present: async () => has(m.editor_siderail_tab_library()) },
  { name: "mediaPool: side rail Photos tab", cap: "mediaPool", trees: ["desktop"], present: async () => has(m.editor_siderail_tab_photos()) },
  {
    name: "commentsLibrary: slash in the notes field is claimed for the library",
    cap: "commentsLibrary",
    trees: ["desktop", "phone"],
    present: async (phone) => {
      await openItem(phone);
      const notes = notesField()!;
      // Claimed (default prevented) means the editor took the key for the library; otherwise it is typed as text.
      return !fireEvent.keyDown(notes, { key: "/" });
    },
  },
  {
    name: "commentsLibrary: the / shortcut is claimed for the library",
    cap: "commentsLibrary",
    trees: ["desktop"],
    present: async () => {
      await openItem(false);
      (document.activeElement as HTMLElement | null)?.blur();
      return !fireEvent.keyDown(window, { key: "/" });
    },
  },
  {
    name: "aiAssist: improve note",
    cap: "aiAssist",
    trees: ["desktop", "phone"],
    present: async (phone) => {
      await openItem(phone);
      return has(m.editor_ai_assist_improve());
    },
  },
  {
    name: "repairItems: attach repair item",
    cap: "repairItems",
    trees: ["desktop", "phone"],
    present: async (phone) => {
      await openItem(phone);
      fireEvent.click(screen.getAllByText(m.editor_item_tab_defects())[0]);
      return has(m.editor_repair_attach());
    },
  },
  {
    name: "video: choice in the add-media chooser",
    cap: "video",
    trees: ["desktop", "phone"],
    present: async (phone) => {
      await openItem(phone);
      fireEvent.click(screen.getByRole("button", { name: m.media_strip_add_photo_aria() }));
      const chooser = await screen.findByRole("dialog", { name: m.editor_addmedia_title() });
      // The other two choices are the control: the chooser keeps working without video.
      expect(within(chooser).queryAllByRole("button", { name: m.editor_addmedia_take_photo() })).toHaveLength(1);
      expect(within(chooser).queryAllByRole("button", { name: m.editor_addmedia_add_from_library() })).toHaveLength(1);
      return within(chooser).queryAllByRole("button", { name: m.editor_addmedia_video() }).length > 0;
    },
  },
  {
    name: "commentsLibrary: the ; shortcut is claimed for the library",
    cap: "commentsLibrary",
    trees: ["desktop"],
    present: async () => {
      await openItem(false);
      (document.activeElement as HTMLElement | null)?.blur();
      return !fireEvent.keyDown(window, { key: ";" });
    },
  },
  {
    name: "commentsLibrary: Cmd+D (save as snippet) is claimed",
    cap: "commentsLibrary",
    trees: ["desktop"],
    present: async () => {
      await openItem(false);
      (document.activeElement as HTMLElement | null)?.blur();
      return !fireEvent.keyDown(window, { key: "d", metaKey: true });
    },
  },
  {
    name: "commentsLibrary: the notes placeholder advertises the library",
    cap: "commentsLibrary",
    trees: ["desktop", "phone"],
    present: async (phone) => {
      await openItem(phone);
      return screen.queryByPlaceholderText(m.editor_item_notes_placeholder()) !== null;
    },
  },
  ...([
    ["Open Comment Library row", () => m.editor_hud_content_library()],
    ["Insert snippet row", () => m.editor_hud_content_snippet()],
    ["Save current as snippet row", () => m.editor_hud_content_save_snippet()],
  ] as const).map(([row, label]): Entry => ({
    name: `commentsLibrary: shortcut sheet, ${row}`,
    cap: "commentsLibrary",
    trees: ["desktop"],
    present: async () => {
      fireEvent.keyDown(window, { key: "?" });
      const sheet = await screen.findByRole("dialog", { name: m.editor_shortcuts_heading() });
      // The sheet still lists the shortcuts that need no library.
      expect(within(sheet).queryAllByText(m.editor_item_add_photo())).toHaveLength(1);
      return within(sheet).queryAllByText(label()).length > 0;
    },
  })),
  {
    name: "commentsLibrary: footer shortcut list, Open library",
    cap: "commentsLibrary",
    trees: ["desktop"],
    present: async () => {
      fireEvent.click(screen.getByRole("button", { name: endsWith(m.editor_shortcuts_label()) }));
      expect(screen.queryAllByText(m.editor_footer_shortcut_photo())).toHaveLength(1);
      return screen.queryAllByText(m.editor_footer_shortcut_library()).length > 0;
    },
  },
  {
    name: "settingsSheet: Template menu divider goes with Change template",
    cap: "settingsSheet",
    trees: ["desktop"],
    present: async () => {
      fireEvent.click(screen.getByRole("button", { name: m.template_menu_template() }));
      return screen.getByRole("menu", { name: m.template_menu_actions_aria() }).querySelector("li[aria-hidden]") !== null;
    },
  },
  {
    name: "settingsSheet: Choose a template call to action",
    cap: "settingsSheet",
    trees: ["desktop", "phone"],
    data: EMPTY_TEMPLATE_DATA,
    present: async () => has(m.editor_route_choose_template()),
  },
  {
    name: "video: poster-frame action in the media viewer",
    cap: "video",
    trees: ["desktop"],
    data: VIDEO_DATA,
    present: async (phone) => {
      await openItem(phone);
      fireEvent.click(await screen.findByTestId("thumb-0"));
      // The other toolbar actions are the control: the viewer itself opened.
      await screen.findByRole("button", { name: m.media_viewer_caption() });
      return has(m.media_viewer_poster());
    },
  },
  { name: "renderThemeControl: header", cap: "renderThemeControl", trees: ["desktop"], present: async () => screen.queryAllByTestId("theme-control").length > 0 },
  { name: "renderThemeControl: phone Theme tab", cap: "renderThemeControl", trees: ["phone"], present: async () => has(endsWith(m.nav_theme_label())) },
  // The side rail also has a "Preview" tab, hence the menu check.
  { name: "pdf: Preview menu", cap: "pdf", trees: ["desktop"], present: async () => screen.queryAllByRole("button", { name: m.editor_header_preview() }).some((b) => b.getAttribute("aria-haspopup") === "menu") },
];

describe("FieldEditor optional capabilities", () => {
  // One case per (tree, entry, omitted capability), so a failure names all three and no case mounts more than once.
  const cases = (["desktop", "phone"] as const).flatMap((tree) =>
    ENTRIES.filter((e) => e.trees.includes(tree)).flatMap((entry) =>
      [null, ...ALL_OMITS].map((omit) => ({ tree, entry, omit, title: `${tree}: ${entry.name} | ${omit === null ? "everything provided" : `without ${omit}`}` })),
    ),
  );

  it.each(cases.map((c) => [c.title, c] as const))("%s", async (_title, { tree, entry, omit }) => {
    const phone = tree === "phone";
    mount(omit, phone, entry.data);
    // Let the editor finish mounting before a person would reach for anything.
    await screen.findByRole("button", { name: phone ? endsWith(m.editor_mobile_drawer_items()) : m.editor_header_publish() });
    const shown = await entry.present(phone);
    // Shown unless the capability that serves it is the one left out; controls (cap null) are always shown.
    const expected = entry.cap === null || entry.cap !== omit;
    expect(shown, `${entry.name} should be ${expected ? "shown" : "hidden"} ${omit === null ? "when every capability is provided" : `without ${omit}`}`).toBe(expected);
  });

  it("opens the cost items drawer from its entry when the host provides the cost lines", async () => {
    mount(null, false);
    fireEvent.click(await screen.findByRole("button", { name: m.editor_route_cost_items() }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: m.editor_cost_items_title() })).toBeTruthy());
  });

  describe("Cmd+D (save as snippet)", () => {
    afterEach(() => localStorage.removeItem("oi:snippets"));
    async function typeNotesAndPressCmdD(omit: Absent | null) {
      const fake = mount(omit, false);
      await openItem(false);
      fireEvent.change(notesField()!, { target: { value: "Granule loss at the eave." } });
      (document.activeElement as HTMLElement | null)?.blur();
      const notPrevented = fireEvent.keyDown(window, { key: "d", metaKey: true });
      return { fake, notPrevented };
    }

    it("without a library: the key is left to the browser and nothing is written to the device", async () => {
      const { notPrevented } = await typeNotesAndPressCmdD("commentsLibrary");
      expect(notPrevented).toBe(true);
      await new Promise((r) => setTimeout(r, 50));
      expect(localStorage.getItem("oi:snippets")).toBeNull();
    });

    it("CONTROL - with a library: the key is claimed and the snippet is saved through the library, not the device", async () => {
      const { fake, notPrevented } = await typeNotesAndPressCmdD(null);
      expect(notPrevented).toBe(false);
      await waitFor(() => expect((fake.resources.commentsLibrary as FakeCommentsLibrary).saved()).toHaveLength(1));
      expect(localStorage.getItem("oi:snippets")).toBeNull();
    });
  });
});
