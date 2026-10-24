// @vitest-environment happy-dom
/**
 * Which tree the editor renders at which width: phone under 768, tablet 768-1023, desktop from 1024. The stubbed
 * viewport answers every `max-width` query from one width, so the tablet band is real here, not folded into
 * "not a phone". Each tree marks its root with `data-layout`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { m } from "../i18n";
import { mount, resizeViewport } from "./FieldEditor.capabilities.fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

type Layout = "phone" | "tablet" | "desktop";
const layoutRoots = () => Array.from(document.querySelectorAll("[data-layout]")).map((el) => el.getAttribute("data-layout"));
const notes = () => document.getElementById("notes-textarea") as HTMLTextAreaElement | null;

async function settled(expected: Layout) {
  // A remount of the whole tree can take a while when the suite runs in parallel.
  await waitFor(() => expect(layoutRoots()).toEqual([expected]), { timeout: 5000 });
}

describe("editor layout bands", () => {
  it.each([
    [375, "phone"],
    [414, "phone"],
    [767, "phone"],
    [768, "tablet"],
    [834, "tablet"],
    [1023, "tablet"],
    [1024, "desktop"],
    [1100, "desktop"],
    [1440, "desktop"],
  ] as const)("width %i renders exactly one %s tree", async (width, layout) => {
    mount(null, false, undefined, width);
    await settled(layout);
  });

  it("768-1023 is a top bar over two panes: the list and the editor together, no bottom tabs, no desktop header", async () => {
    mount(null, false, undefined, 834);
    await settled("tablet");
    const bar = await screen.findByRole("banner");
    expect(within(bar).getByRole("button", { name: m.editor_mobile_drawer_sections() })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: m.editor_route_drawer_preview() })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: m.editor_header_publish() })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: m.editor_mobile_more() })).toBeTruthy();
    expect(document.querySelector("nav.fixed.bottom-0")).toBeNull();
    // Open the first item: the list pane and the editor pane are on screen at the same time.
    const list = screen.getByTestId("tablet-list-pane");
    fireEvent.click(within(list).getByText("Flashing condition"));
    await waitFor(() => expect(notes()).not.toBeNull());
    expect(list.contains(notes())).toBe(false);
    expect(screen.getByTestId("tablet-editor-pane").contains(notes())).toBe(true);
    expect(within(list).getByText("Flashing condition")).toBeTruthy();
  });

  it("crossing 767/768 and 1023/1024 switches the tree at the right pixel and loses neither the open item nor the typed note", async () => {
    mount(null, false, undefined, 1024);
    await settled("desktop");
    fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
    await waitFor(() => expect(notes()).not.toBeNull());
    fireEvent.change(notes()!, { target: { value: "Granule loss at the eave." } });

    const steps: Array<[number, Layout]> = [[1023, "tablet"], [768, "tablet"], [767, "phone"], [768, "tablet"], [1024, "desktop"], [1023, "tablet"], [767, "phone"], [1024, "desktop"]];
    for (const [width, layout] of steps) {
      resizeViewport(width);
      await settled(layout);
      await waitFor(() => expect(notes()?.value, `at ${width}px`).toBe("Granule loss at the eave."), { timeout: 5000 });
    }
  });
});
