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
