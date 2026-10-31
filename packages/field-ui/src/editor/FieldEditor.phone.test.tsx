// @vitest-environment happy-dom
/**
 * The phone tree: the overlays it shares with the desktop tree, the touch entry points that replace the keyboard,
 * and the ergonomics the spec pins (hit areas, dynamic viewport height, safe area). Which entry points exist for
 * which host capability is in `FieldEditor.capabilities.test.tsx`; this file is what they DO once pressed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { EditorData } from "../data-source";
import { m } from "../i18n";
import type { FakeCommentsLibrary } from "../testing/fake-data-source";
import { createEmptyEditorData } from "../testing/fake-data-source";
import { DATA, VIDEO_DATA, mount, resizeViewport, stubCamera } from "./FieldEditor.capabilities.fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

const itemsTab = () => screen.findByRole("button", { name: new RegExp(`${m.editor_mobile_drawer_items()}$`) });

async function openItem() {
  fireEvent.click(await itemsTab());
  fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
  await screen.findByRole("button", { name: m.editor_item_open_library() });
}

async function openMore() {
  fireEvent.click(await screen.findByRole("button", { name: m.editor_mobile_more() }));
  await screen.findByRole("button", { name: m.editor_header_publish() });
}

describe("phone tree: touch entry points", () => {
  it("More drawer order: Publish, Sign now, Finish fieldwork, then Capture, then Inspection, in sentence case", async () => {
    mount(null, true);
    await openItem();
    await openMore();
    const sheet = screen.getByRole("dialog", { name: m.editor_mobile_more() });
    const text = sheet.textContent ?? "";
    const at = (s: string) => text.indexOf(s);
    expect(at(m.editor_header_publish())).toBeGreaterThanOrEqual(0);
    const order = [
      m.editor_header_publish(),
      m.editor_header_sign(),
      m.editor_finish_fieldwork(),
      m.editor_mobile_group_capture(),
      m.editor_mobile_burst_camera(),
      m.editor_mobile_group_inspection(),
      m.editor_header_version_history(),
      m.editor_route_units(),
      m.editor_route_cost_items(),
      m.editor_header_settings(),
    ].map(at);
    expect(order.every((i) => i >= 0), `every entry is in the drawer: ${order.join(",")}`).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // No all-caps eyebrow: the group labels are plain sentence-case text.
    for (const label of [m.editor_mobile_group_capture(), m.editor_mobile_group_inspection()]) {
      const el = within(sheet).getByText(label);
      expect(el.className).not.toMatch(/uppercase/);
    }
  });

  it("no camera means no Burst row; Speed mode still fills the Capture group", async () => {
    mount("cameraCapture", true);
    await openItem();
    await openMore();
    const sheet = screen.getByRole("dialog", { name: m.editor_mobile_more() });
    expect(within(sheet).queryByRole("button", { name: m.editor_mobile_burst_camera() })).toBeNull();
    expect(within(sheet).queryByText(m.editor_mobile_group_capture())).not.toBeNull();
    expect(within(sheet).queryByText(m.editor_mobile_group_inspection())).not.toBeNull();
  });

  it("a group with no rows is not shown: nothing to rate and no camera means no Capture heading", async () => {
    mount("cameraCapture", true, createEmptyEditorData({ ...DATA, results: { "_default:s1:i1": { rating: "ok" } } }));
    await openItem();
    await openMore();
    const sheet = screen.getByRole("dialog", { name: m.editor_mobile_more() });
    expect(within(sheet).queryByText(m.editor_mobile_group_capture())).toBeNull();
    expect(within(sheet).queryByText(m.editor_mobile_group_inspection())).not.toBeNull();
  });

  it("Burst camera opens one camera and the drawer lets go of the screen", async () => {
    mount(null, true);
    const calls = stubCamera(true);
    await openItem();
    await openMore();
    fireEvent.click(screen.getByRole("button", { name: m.editor_mobile_burst_camera() }));
    expect(await screen.findAllByRole("dialog", { name: m.editor_burst_camera_aria() })).toHaveLength(1);
    await waitFor(() => expect(calls.getUserMedia).toBe(1));
  });

  it("Library opens one bottom sheet, search first, and one tap on a row inserts it and closes", async () => {
    const fake = mount(null, true);
    (fake.resources.commentsLibrary as FakeCommentsLibrary).setRows([
      { id: "c1", text: "Flashing is lifted at the chimney.", severity: "significant" },
    ] as Parameters<FakeCommentsLibrary["setRows"]>[0]);
    await openItem();
    fireEvent.click(screen.getByRole("button", { name: m.editor_item_open_library() }));
    const sheets = await screen.findAllByRole("dialog", { name: m.editor_comment_library_title() });
    expect(sheets).toHaveLength(1);
    const sheet = sheets[0];
    const search = within(sheet).getByPlaceholderText(m.editor_comment_library_search_placeholder());
    // Search is the first field in the sheet (sort and filter come after it), and the open sheet does not put the
    // caret in it: focus lands on Close, so no soft keyboard rises over the list.
    expect([...sheet.querySelectorAll<HTMLElement>("input,select")][0]).toBe(search);
    expect(document.activeElement).not.toBe(search);
    fireEvent.click(await within(sheet).findByText("Flashing is lifted at the chimney."));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: m.editor_comment_library_title(), hidden: false })).toBeNull());
    expect((document.getElementById("notes-textarea") as HTMLTextAreaElement).value).toContain("Flashing is lifted at the chimney.");
  });
});

describe("one overlay per tree", () => {
  const OVERLAYS = [
    {
      name: "Units manager",
      dialog: () => m.editor_unitsmanager_title(),
      open: async (phone: boolean) => {
        if (phone) {
          await openMore();
          fireEvent.click(screen.getByRole("button", { name: m.editor_route_units() }));
        } else fireEvent.click(await screen.findByRole("button", { name: m.editor_route_units() }));
      },
    },
    {
      name: "Cost items",
      dialog: () => m.editor_cost_items_title(),
      open: async (phone: boolean) => {
        if (phone) {
          await openMore();
          fireEvent.click(screen.getByRole("button", { name: m.editor_route_cost_items() }));
        } else fireEvent.click(await screen.findByRole("button", { name: m.editor_route_cost_items() }));
      },
    },
    {
      name: "Version history",
      dialog: () => m.editor_collab_version_history(),
      open: async (phone: boolean) => {
        if (phone) {
          await openMore();
          fireEvent.click(screen.getByRole("button", { name: m.editor_header_version_history() }));
        } else fireEvent.click(await screen.findByRole("button", { name: m.editor_header_version_history() }));
      },
    },
  ] as const;

  it.each(
    (["phone", "desktop"] as const).flatMap((tree) => OVERLAYS.map((o) => [`${tree}: ${o.name}`, tree, o] as const)),
  )("%s opens exactly one dialog", async (_title, tree, overlay) => {
    const phone = tree === "phone";
    mount(null, phone);
    await screen.findByRole("button", { name: phone ? new RegExp(`${m.editor_mobile_drawer_items()}$`) : m.editor_header_publish() });
    await overlay.open(phone);
    expect(await screen.findAllByRole("dialog", { name: overlay.dialog() })).toHaveLength(1);
  });

  it.each([["phone", true], ["desktop", false]] as const)("%s: the unsaved-changes guard is mounted once", async (_tree, phone) => {
    mount(null, phone);
    await screen.findByRole("button", { name: phone ? new RegExp(`${m.editor_mobile_drawer_items()}$`) : m.editor_header_publish() });
    expect(screen.getAllByTestId("unsaved-guard")).toHaveLength(1);
  });
});

describe("phone user paths into the shared overlays", () => {
  it("tapping a photo thumbnail opens the media viewer", async () => {
    mount(null, true, VIDEO_DATA);
    fireEvent.click(await itemsTab());
    fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
    fireEvent.click(await screen.findByTestId("thumb-0"));
    // The viewer's own toolbar is on screen, and it is the only one.
    expect(await screen.findAllByRole("button", { name: m.media_viewer_caption() })).toHaveLength(1);
  });

  async function openSections() {
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${m.editor_mobile_drawer_sections()}$`) }));
    await screen.findByRole("button", { name: m.editor_shared_add_section() });
  }

  it("the Sections drawer can add a section: the title prompt appears, once", async () => {
    mount(null, true);
    await openSections();
    fireEvent.click(screen.getByRole("button", { name: m.editor_shared_add_section() }));
    expect(await screen.findAllByRole("dialog", { name: m.editor_addsection_title() })).toHaveLength(1);
  });

  it("the Sections drawer can delete a section: the confirmation appears, once", async () => {
    // Structure edits work on the template snapshot the loader hands over, not on the live schema.
    mount(null, true, createEmptyEditorData({ ...DATA, templateSnapshot: { ...DATA.schema, schemaVersion: 2 } as unknown as EditorData["templateSnapshot"] }));
    await openSections();
    fireEvent.click(screen.getByRole("button", { name: m.editor_shared_section_options({ title: "Roofing" }) }));
    fireEvent.click(await screen.findByText(m.common_delete()));
    expect(await screen.findAllByRole("dialog", { name: /Roofing/ })).toHaveLength(1);
  });
});

describe("phone ergonomics", () => {
  it("the root uses the dynamic viewport and the safe area, never min-h-screen", async () => {
    mount(null, true);
    const header = await screen.findByRole("banner");
    const root = header.parentElement as HTMLElement;
    expect(root.className).toContain("min-h-dvh");
    expect(root.className).not.toContain("min-h-screen");
    expect(root.className).toContain("pb-[var(--ih-mobile-nav-h)]");
    const nav = (await itemsTab()).closest("nav") as HTMLElement;
    expect(nav.className).toContain("pb-[env(safe-area-inset-bottom)]");
  });

  it("every app bar and bottom tab control has a 44px hit area and no 300ms tap delay", async () => {
    mount(null, true);
    const header = await screen.findByRole("banner");
    for (const b of within(header).getAllByRole("button")) {
      expect(b.className).toContain("w-11");
      expect(b.className).toContain("h-11");
      expect(b.className).toContain("touch-manipulation");
    }
    for (const b of (await itemsTab()).closest("nav")!.querySelectorAll("button")) {
      expect(b.className).toContain("touch-manipulation");
      expect(b.className).toContain("min-h-11");
    }
  });
});

describe("layout switch", () => {
  it("keeps the open item and what was typed when the viewport crosses from phone to desktop and back", async () => {
    mount(null, true);
    await openItem();
    const notes = () => document.getElementById("notes-textarea") as HTMLTextAreaElement | null;
    fireEvent.change(notes()!, { target: { value: "Granule loss at the eave." } });
    resizeViewport(false);
    await waitFor(() => expect(screen.queryByRole("banner")).toBeNull());
    await waitFor(() => expect(notes()?.value).toBe("Granule loss at the eave."));
    resizeViewport(true);
    await waitFor(() => expect(screen.queryByRole("banner")).not.toBeNull());
    await waitFor(() => expect(notes()?.value).toBe("Granule loss at the eave."));
  });
});
