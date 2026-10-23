// @vitest-environment happy-dom
/**
 * Which tree the editor renders at which width. Until the tablet gets a tree of its own, 768-1023 renders the
 * desktop tree; only below 768 is it the phone tree. The stubbed viewport answers every `max-width` query from
 * one width, so the tablet band is real here, not folded into "not a phone".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { m } from "../i18n";
import { mount, resizeViewport } from "./FieldEditor.capabilities.fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

const isPhoneTree = () => screen.queryByRole("banner") !== null && screen.queryByRole("button", { name: m.editor_header_publish() }) === null;
/** The desktop header carries Publish as a visible button; the phone tree keeps it inside the (hidden) More drawer. */
const isDesktopTree = () => screen.queryByRole("button", { name: m.editor_header_publish() }) !== null;
const notes = () => document.getElementById("notes-textarea") as HTMLTextAreaElement | null;

async function settled(expectPhone: boolean) {
  // A remount of the whole tree can take a while when the suite runs in parallel.
  await waitFor(() => (expectPhone ? expect(isPhoneTree()).toBe(true) : expect(isDesktopTree()).toBe(true)), { timeout: 5000 });
  expect(expectPhone ? isDesktopTree() : isPhoneTree()).toBe(false);
}

describe("editor layout bands", () => {
  it.each([
    [375, "phone"],
    [414, "phone"],
    [767, "phone"],
    [768, "desktop"],
    [834, "desktop"],
    [1023, "desktop"],
    [1024, "desktop"],
    [1440, "desktop"],
  ] as const)("width %i renders the %s tree", async (width, tree) => {
    const phone = tree === "phone";
    mount(null, false, undefined, width);
    await screen.findByRole("button", { name: phone ? new RegExp(`${m.editor_mobile_drawer_items()}$`) : m.editor_header_publish() });
    await settled(phone);
  });

  it("768-1023 shows the same tree as desktop: header actions and the four-column rails, no bottom tabs", async () => {
    mount(null, false, undefined, 834);
    await screen.findByRole("button", { name: m.editor_header_publish() });
    expect(screen.queryByRole("banner")).toBeNull();
    expect(document.querySelector("nav.fixed.bottom-0")).toBeNull();
    // The rails desktop has are mounted: the item list shows the template's item without opening any drawer.
    expect(screen.queryAllByText("Flashing condition").length).toBeGreaterThan(0);
  });

  it("crossing 767/768 and 1023/1024 switches the tree at the right pixel and loses neither the open item nor the typed note", async () => {
    mount(null, false, undefined, 1024);
    await screen.findByRole("button", { name: m.editor_header_publish() });
    fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
    await waitFor(() => expect(notes()).not.toBeNull());
    fireEvent.change(notes()!, { target: { value: "Granule loss at the eave." } });

    const steps: Array<[number, boolean]> = [[1023, false], [768, false], [767, true], [768, false], [1024, false], [1023, false], [767, true], [1024, false]];
    for (const [width, phone] of steps) {
      resizeViewport(width);
      await settled(phone);
      await waitFor(() => expect(notes()?.value, `at ${width}px`).toBe("Granule loss at the eave."), { timeout: 5000 });
    }
  });
});
