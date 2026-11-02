// @vitest-environment happy-dom
/**
 * The real lightbox (not a stand-in): a wrapping toolbar spans the width and wraps, and leaving the option off
 * must not hand the library an explicit `styles: undefined`, which replaces its default and throws on open.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PhotoLightbox } from "./PhotoLightbox";

afterEach(cleanup);

const slides = [{ src: "/p.jpg", alt: "Roof" }];
const toolbar = () => document.querySelector<HTMLElement>(".yarl__toolbar");
const buttons = [<button key="a" type="button">Annotate</button>];

describe("PhotoLightbox toolbarWrap", () => {
  it("wraps the toolbar across the full width when asked", () => {
    render(<PhotoLightbox slides={slides} index={0} open onClose={() => {}} toolbarButtons={buttons} toolbarWrap />);
    expect(toolbar()?.style.flexWrap).toBe("wrap");
    expect(toolbar()?.style.left).toBe("0px");
  });

  it("without the option the toolbar has no inline style and the lightbox opens", () => {
    render(<PhotoLightbox slides={slides} index={0} open onClose={() => {}} toolbarButtons={buttons} />);
    expect(toolbar()).not.toBeNull();
    expect(toolbar()?.style.flexWrap ?? "").toBe("");
  });
});

describe("PhotoLightbox safe area", () => {
  const padding = () => toolbar()?.style.getPropertyValue("--yarl__toolbar_padding") ?? "";

  it("keeps the toolbar out from under a notch or the status bar: the top padding adds the top safe-area inset (the library pins the toolbar to top:0 with a flat 8px)", () => {
    render(<PhotoLightbox slides={slides} index={0} open onClose={() => {}} toolbarButtons={buttons} />);
    expect(padding()).toContain("env(safe-area-inset-top)");
  });

  it("also keeps both side insets, so a phone held sideways does not cut the first and last button", () => {
    render(<PhotoLightbox slides={slides} index={0} open onClose={() => {}} toolbarButtons={buttons} />);
    expect(padding()).toContain("env(safe-area-inset-left)");
    expect(padding()).toContain("env(safe-area-inset-right)");
  });

  it("holds when the toolbar wraps too, and the wrap options survive next to it", () => {
    render(<PhotoLightbox slides={slides} index={0} open onClose={() => {}} toolbarButtons={buttons} toolbarWrap />);
    expect(padding()).toContain("env(safe-area-inset-top)");
    expect(toolbar()?.style.flexWrap).toBe("wrap");
    expect(toolbar()?.style.left).toBe("0px");
  });
});
