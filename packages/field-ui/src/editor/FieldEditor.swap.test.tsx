// @vitest-environment happy-dom
/**
 * A rotation across a layout breakpoint (phone 767/768, tablet 1023/1024) swaps the whole tree. What is in flight
 * must come through it: the note being typed (in the results DOCUMENT, not just the textarea), an open camera
 * overlay with its captured frames, a half-typed custom defect, the sheet a person is filling in. And batch select,
 * which the phone has no control for, must not follow the person to a layout where it cannot be left.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { m } from "../i18n";
import { readResultMap } from "../collab/results-binding";
import { DATA, fullResources, resizeViewport } from "./FieldEditor.capabilities.fixtures";
import { mountForRatings, RATING_DATA, type RatingMount } from "./FieldEditor.rating.fixtures";

// The camera needs a device; a stand-in with the same mount point and a frame counter in its OWN state shows
// whether the instance survives a swap (a remount would reset the counter and count a second mount).
const probe = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
vi.mock("../components/editor/BurstCamera", async () => {
  const React = await import("react");
  return {
    BurstCamera: ({ open }: { open: boolean }) => {
      const [frames, setFrames] = React.useState(0);
      React.useEffect(() => {
        probe.mounts += 1;
        return () => { probe.unmounts += 1; };
      }, []);
      return open ? <button data-testid="burst-capture" onClick={() => setFrames((n) => n + 1)}>{`frames:${frames}`}</button> : null;
    },
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
  Reflect.deleteProperty(document, "visibilityState");
  probe.mounts = 0;
  probe.unmounts = 0;
});

const notes = () => document.getElementById("notes-textarea") as HTMLTextAreaElement | null;
const layoutIs = (layout: string) => waitFor(() => expect(Array.from(document.querySelectorAll("[data-layout]")).map((el) => el.getAttribute("data-layout"))).toEqual([layout]), { timeout: 5000 });
const docNotes = (h: RatingMount) => readResultMap(h.doc())["_default:s1:i1"]?.notes;
const itemsTab = () => screen.findByRole("button", { name: new RegExp(`${m.editor_mobile_drawer_items()}$`) });

async function openDesktopItem() {
  fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
  await waitFor(() => expect(notes()).not.toBeNull());
}
async function openPhoneItem() {
  fireEvent.click(await itemsTab());
  fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
  await waitFor(() => expect(notes()).not.toBeNull());
}

describe("a note typed before a layout swap reaches the results document", () => {
  it("desktop -> tablet: the document holds the note after the swap, not only the textarea", async () => {
    const h = mountForRatings(1280);
    await layoutIs("desktop");
    await openDesktopItem();
    fireEvent.change(notes()!, { target: { value: "Granule loss at the eave." } });
    expect(docNotes(h)).toBeUndefined();
    resizeViewport(834);
    await layoutIs("tablet");
    await waitFor(() => expect(docNotes(h)).toBe("Granule loss at the eave."));
    expect(notes()?.value).toBe("Granule loss at the eave.");
  });

  it("tablet -> phone and phone -> desktop commit the same way", async () => {
    const h = mountForRatings(834);
    await layoutIs("tablet");
    fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
    await waitFor(() => expect(notes()).not.toBeNull());
    fireEvent.change(notes()!, { target: { value: "first" } });
    resizeViewport(390);
    await layoutIs("phone");
    await waitFor(() => expect(docNotes(h)).toBe("first"));
    fireEvent.change(notes()!, { target: { value: "second" } });
    resizeViewport(1280);
    await layoutIs("desktop");
    await waitFor(() => expect(docNotes(h)).toBe("second"));
  });

  it("the page being hidden or closed commits it", async () => {
    const h = mountForRatings(1280);
    await openDesktopItem();
    fireEvent.change(notes()!, { target: { value: "hidden tab" } });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(docNotes(h)).toBe("hidden tab");
    Reflect.deleteProperty(document, "visibilityState");
    fireEvent.change(notes()!, { target: { value: "closed page" } });
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(docNotes(h)).toBe("closed page");
  });

  it("CONTROL - a visible tab commits nothing by itself", async () => {
    const h = mountForRatings(1280);
    await openDesktopItem();
    fireEvent.change(notes()!, { target: { value: "still typing" } });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(docNotes(h)).toBeUndefined();
  });

  it("phone: Back out of the open item commits the note", async () => {
    const h = mountForRatings(390);
    await openPhoneItem();
    fireEvent.change(notes()!, { target: { value: "left behind" } });
    fireEvent.click(screen.getByRole("button", { name: m.common_back() }));
    await waitFor(() => expect(notes()).toBeNull());
    expect(docNotes(h)).toBe("left behind");
  });

  it("a note never lands on another item: switching items first leaves the old text out of the new item", async () => {
    const h = mountForRatings(1280);
    await openDesktopItem();
    fireEvent.change(notes()!, { target: { value: "for the first item" } });
    fireEvent.click((await screen.findAllByText("Gutter condition"))[0]);
    await waitFor(() => expect(notes()?.value).toBe(""));
    resizeViewport(834);
    await layoutIs("tablet");
    expect(readResultMap(h.doc())["_default:s1:i2"]?.notes).toBeUndefined();
  });
});

describe("overlays and item editor state come through a swap", () => {
  it("an open camera keeps its instance and its captured frames", async () => {
    mountForRatings(390, { data: DATA, resources: fullResources() });
    await openPhoneItem();
    fireEvent.click(screen.getByRole("button", { name: m.editor_mobile_more() }));
    fireEvent.click(await screen.findByRole("button", { name: m.editor_mobile_burst_camera() }));
    fireEvent.click(await screen.findByTestId("burst-capture"));
    fireEvent.click(screen.getByTestId("burst-capture"));
    expect(screen.getByTestId("burst-capture").textContent).toBe("frames:2");
    const mountsBefore = probe.mounts;
    resizeViewport(834);
    await layoutIs("tablet");
    resizeViewport(1280);
    await layoutIs("desktop");
    resizeViewport(390);
    await layoutIs("phone");
    expect(screen.getByTestId("burst-capture").textContent).toBe("frames:2");
    expect(probe.mounts).toBe(mountsBefore);
    expect(probe.unmounts).toBe(0);
  });

  it("a half-typed custom defect, and the tab it is on, survive", async () => {
    mountForRatings(1280, { data: DATA, resources: fullResources() });
    await openDesktopItem();
    fireEvent.click((await screen.findAllByText(m.editor_item_tab_defects()))[0]);
    fireEvent.click(await screen.findByRole("button", { name: m.editor_canned_add_custom() }));
    fireEvent.change(await screen.findByLabelText(m.editor_customdefect_title_aria()), { target: { value: "Cracked flashing" } });
    fireEvent.change(screen.getByLabelText(m.editor_customdefect_narrative_aria()), { target: { value: "North valley." } });
    resizeViewport(834);
    await layoutIs("tablet");
    expect(((await screen.findByLabelText(m.editor_customdefect_title_aria())) as HTMLInputElement).value).toBe("Cracked flashing");
    expect((screen.getByLabelText(m.editor_customdefect_narrative_aria()) as HTMLTextAreaElement).value).toBe("North valley.");
    resizeViewport(390);
    await layoutIs("phone");
    expect(((await screen.findByLabelText(m.editor_customdefect_title_aria())) as HTMLInputElement).value).toBe("Cracked flashing");
  });

  it("the report settings sheet keeps the choice made in it", async () => {
    mountForRatings(390, { data: DATA, resources: fullResources() });
    await itemsTab();
    fireEvent.click(screen.getByRole("button", { name: m.editor_mobile_more() }));
    fireEvent.click(await screen.findByRole("button", { name: m.editor_header_settings() }));
    const select = async () => {
      const el = await screen.findByLabelText(new RegExp(m.editor_settings_required_defect_fields()));
      if (!(el instanceof HTMLSelectElement)) throw new Error("the required-defect-fields control is not a select");
      return el;
    };
    fireEvent.change(await select(), { target: { value: "both" } });
    expect((await select()).value).toBe("both");
    resizeViewport(834);
    await layoutIs("tablet");
    expect((await select()).value).toBe("both");
  });
});

describe("batch select on the phone", () => {
  const toggleOn = () => screen.queryByRole("button", { name: m.editor_route_exit_batch_mode() });
  const toggleOff = () => screen.queryByRole("button", { name: m.editor_route_batch_select_items() });

  it("is switched off when the layout becomes a phone, so it cannot trap the list there", async () => {
    mountForRatings(834);
    await layoutIs("tablet");
    fireEvent.click(await screen.findByRole("button", { name: m.editor_route_batch_select_items() }));
    expect(toggleOn()).not.toBeNull();
    resizeViewport(390);
    await layoutIs("phone");
    // Back on the tablet the toggle is as it was before: off. (The phone has no control to read it from.)
    resizeViewport(834);
    await layoutIs("tablet");
    await waitFor(() => expect(toggleOff()).not.toBeNull());
    expect(toggleOn()).toBeNull();
  });

  it("CONTROL - tablet to desktop keeps batch select on", async () => {
    mountForRatings(834);
    await layoutIs("tablet");
    fireEvent.click(await screen.findByRole("button", { name: m.editor_route_batch_select_items() }));
    resizeViewport(1280);
    await layoutIs("desktop");
    expect(toggleOn()).not.toBeNull();
  });
});

describe("the More drawer's Speed row only opens Speed mode", () => {
  it("pressing it while Speed mode is already open leaves it open", async () => {
    mountForRatings(390, { data: RATING_DATA });
    await itemsTab();
    fireEvent.keyDown(document.body, { key: "z" });
    await screen.findByRole("dialog", { name: m.editor_speedmode_aria_label() });
    fireEvent.click(screen.getByRole("button", { name: m.editor_mobile_more() }));
    const sheet = await screen.findByRole("dialog", { name: m.editor_mobile_more() });
    fireEvent.click(within(sheet).getByRole("button", { name: m.editor_dock_speed_mode() }));
    expect(screen.queryByRole("dialog", { name: m.editor_speedmode_aria_label() })).not.toBeNull();
  });
});
