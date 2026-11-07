// @vitest-environment happy-dom
/**
 * The burst camera needs an item to put its photos on. Without one it must not be offered (phone More drawer,
 * desktop dock), and a commit that reaches the editor with no target must say so instead of dropping the frames.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { m } from "../i18n";
import { ORIGINAL_QUALITY_KEY } from "../shared/original-quality";
import { mount, NO_ITEMS_DATA } from "./FieldEditor.capabilities.fixtures";

// The camera itself is not under test: a stand-in that is always mounted and can "finish" with one frame.
vi.mock("../components/editor/BurstCamera", () => ({
  BurstCamera: ({ onCommit }: { onCommit: (blobs: Blob[]) => void }) => (
    <button data-testid="burst-commit" onClick={() => onCommit([new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" })])} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

const itemsTab = () => screen.findByRole("button", { name: new RegExp(`${m.editor_mobile_drawer_items()}$`) });
async function openPhoneItem() {
  fireEvent.click(await itemsTab());
  fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
  await screen.findByRole("button", { name: m.editor_item_open_library() });
}
async function openMore() {
  fireEvent.click(await screen.findByRole("button", { name: m.editor_mobile_more() }));
  await screen.findByRole("button", { name: m.editor_header_publish() });
}
const burstRows = () => screen.queryAllByRole("button", { name: m.editor_mobile_burst_camera() });

describe("burst camera needs a target item", () => {
  it("phone: no open item means no Burst row (Speed mode keeps the Capture heading); an open item adds the row", async () => {
    mount(null, true, NO_ITEMS_DATA);
    await itemsTab();
    await openMore();
    const sheet = screen.getByRole("dialog", { name: m.editor_mobile_more() });
    expect(burstRows()).toHaveLength(0);
    // Nothing to rate and nothing to open: Capture has no entry at all, so no heading either.
    expect(within(sheet).queryByText(m.editor_mobile_group_capture())).toBeNull();
    // The rest of the drawer is unaffected.
    expect(within(sheet).queryByText(m.editor_mobile_group_inspection())).not.toBeNull();
    cleanup();
    // The editor opens on the first item by itself, so an inspection that has items has one open without a tap.
    mount(null, true);
    await screen.findByRole("button", { name: m.editor_item_open_library() });
    await openMore();
    expect(burstRows()).toHaveLength(1);
    expect(within(screen.getByRole("dialog", { name: m.editor_mobile_more() })).queryByText(m.editor_mobile_group_capture())).not.toBeNull();
  });

  it("desktop: the dock offers Burst camera only once an item is open", async () => {
    mount(null, false, NO_ITEMS_DATA);
    fireEvent.click(await screen.findByRole("button", { name: m.editor_dock_open() }));
    const menu = await screen.findByRole("menu", { name: m.editor_dock_menu_label() });
    expect(within(menu).queryByText(m.editor_dock_burst_camera())).toBeNull();
    // Control: the other tiles are still there.
    expect(within(menu).queryByText(m.editor_dock_photo_studio())).not.toBeNull();
    cleanup();
    // With items, the first one is open from the start, so the dock lists the burst tile at once.
    mount(null, false);
    fireEvent.click(await screen.findByRole("button", { name: m.editor_dock_open() }));
    await waitFor(() => expect(within(screen.getByRole("menu", { name: m.editor_dock_menu_label() })).queryByText(m.editor_dock_burst_camera())).not.toBeNull());
  });

  it("a commit with no target item is announced and uploads nothing", async () => {
    const fake = mount(null, true);
    fireEvent.click(await screen.findByTestId("burst-commit"));
    await waitFor(() => expect(fake.notifications.map((n) => n.message)).toContain(m.editor_burst_no_item()));
    expect(fake.notifications.find((n) => n.message === m.editor_burst_no_item())?.variant).toBe("warning");
  });

  it("CONTROL - a commit with a target item does not raise the no-item notice", async () => {
    localStorage.setItem(ORIGINAL_QUALITY_KEY, "1");
    const fake = mount(null, true);
    await openPhoneItem();
    await openMore();
    fireEvent.click(screen.getByRole("button", { name: m.editor_mobile_burst_camera() }));
    fireEvent.click(screen.getByTestId("burst-commit"));
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.notifications.map((n) => n.message)).not.toContain(m.editor_burst_no_item());
    localStorage.removeItem(ORIGINAL_QUALITY_KEY);
  });
});
