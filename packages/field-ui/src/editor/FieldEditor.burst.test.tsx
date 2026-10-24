// @vitest-environment happy-dom
/**
 * The burst camera needs an item to put its photos on. Without one it must not be offered (phone More drawer,
 * desktop dock), and a commit that reaches the editor with no target must say so instead of dropping the frames.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { m } from "../i18n";
import { ORIGINAL_QUALITY_KEY } from "../shared/original-quality";
import { mount } from "./FieldEditor.capabilities.fixtures";

// The camera itself is not under test: a stand-in that is always mounted and can "finish" with one frame.
vi.mock("../components/editor/BurstCamera", () => ({
  BurstCamera: ({ onCommit }: { onCommit: (blobs: Blob[]) => void }) => (
    <button data-testid="burst-commit" onClick={() => onCommit([new Blob(["frame"], { type: "image/jpeg" })])} />
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
    mount(null, true);
    await itemsTab();
    await openMore();
    const sheet = screen.getByRole("dialog", { name: m.editor_mobile_more() });
    expect(burstRows()).toHaveLength(0);
    // Capture now also holds Speed mode, which needs no open item, so the heading is there without a burst row.
    expect(within(sheet).queryByText(m.editor_mobile_group_capture())).not.toBeNull();
    expect(within(sheet).queryByRole("button", { name: m.editor_dock_speed_mode() })).not.toBeNull();
    // The rest of the drawer is unaffected.
    expect(within(sheet).queryByText(m.editor_mobile_group_inspection())).not.toBeNull();
    cleanup();
    mount(null, true);
    await openPhoneItem();
    await openMore();
    expect(burstRows()).toHaveLength(1);
    expect(within(screen.getByRole("dialog", { name: m.editor_mobile_more() })).queryByText(m.editor_mobile_group_capture())).not.toBeNull();
  });

  it("desktop: the dock offers Burst camera only once an item is open", async () => {
    mount(null, false);
    fireEvent.click(await screen.findByRole("button", { name: m.editor_dock_open() }));
    const menu = await screen.findByRole("menu", { name: m.editor_dock_menu_label() });
    expect(within(menu).queryByText(m.editor_dock_burst_camera())).toBeNull();
    // Control: the other tiles are still there.
    expect(within(menu).queryByText(m.editor_dock_photo_studio())).not.toBeNull();
    fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
    await waitFor(() => expect(screen.queryByPlaceholderText(m.editor_item_notes_placeholder_no_library()) ?? screen.queryByPlaceholderText(m.editor_item_notes_placeholder())).not.toBeNull());
    // The dock menu is still open; with an item it now lists the burst tile.
    expect(within(screen.getByRole("menu", { name: m.editor_dock_menu_label() })).queryByText(m.editor_dock_burst_camera())).not.toBeNull();
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
