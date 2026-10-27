// @vitest-environment happy-dom
/** Choosing an item while Inspection Details is showing leaves the details and opens the item. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { m } from "../i18n";
import { mountForRatings } from "./FieldEditor.rating.fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe.each([["desktop", 1280], ["tablet", 834]] as const)("%s: items while Inspection Details is open", (_tree, width) => {
  it("a click on an item shows that item, not the details", async () => {
    mountForRatings(width);
    fireEvent.click(await screen.findByTestId("inspection-details-entry"));
    await screen.findByTestId("property-info-form");
    fireEvent.click((await screen.findAllByText("Gutter condition"))[0]);
    expect(await screen.findByRole("radiogroup", { name: m.editor_rating_aria() })).toBeTruthy();
    expect(screen.queryByTestId("property-info-form")).toBeNull();
  });

  it("CONTROL - the details stay up until an item is chosen", async () => {
    mountForRatings(width);
    fireEvent.click(await screen.findByTestId("inspection-details-entry"));
    await screen.findByTestId("property-info-form");
    expect(screen.queryByRole("radiogroup", { name: m.editor_rating_aria() })).toBeNull();
  });
});

describe("the Items list while Inspection Details is open", () => {
  const marked = () => Array.from(document.querySelectorAll("[class*='border-l-[3px]']")).length;

  it("marks no item as the current one, and marks the open item again once one is chosen", async () => {
    mountForRatings(1280);
    fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
    await screen.findByRole("radiogroup", { name: m.editor_rating_aria() });
    expect(marked()).toBe(1);
    fireEvent.click(await screen.findByTestId("inspection-details-entry"));
    await screen.findByTestId("property-info-form");
    expect(marked()).toBe(0);
    fireEvent.click((await screen.findAllByText("Gutter condition"))[0]);
    await screen.findByRole("radiogroup", { name: m.editor_rating_aria() });
    expect(marked()).toBe(1);
  });
});

describe("opening Inspection Details", () => {
  it("scrolls to the top: the window on a phone, the editor pane on desktop", async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    mountForRatings(1280);
    await screen.findAllByText("Gutter condition");
    const pane = document.querySelector("main") as HTMLElement;
    pane.scrollTop = 120;
    scrollTo.mockClear();
    fireEvent.click(await screen.findByTestId("inspection-details-entry"));
    await screen.findByTestId("property-info-form");
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(pane.scrollTop).toBe(0);
  });

  it("CONTROL - choosing an item does not scroll", async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    mountForRatings(1280);
    fireEvent.click((await screen.findAllByText("Gutter condition"))[0]);
    await screen.findByRole("radiogroup", { name: m.editor_rating_aria() });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("lines the property form up with the rest of the phone page: no side padding below md", async () => {
    mountForRatings(390);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${m.editor_mobile_drawer_sections()}$`) }));
    fireEvent.click(await screen.findByTestId("inspection-details-entry"));
    const form = await screen.findByTestId("property-info-form");
    expect(form.className.split(/\s+/)).toEqual(expect.arrayContaining(["px-0", "md:px-6"]));
    expect(form.className.split(/\s+/)).not.toContain("px-6");
  });
});
