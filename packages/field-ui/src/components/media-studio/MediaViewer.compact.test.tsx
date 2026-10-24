// @vitest-environment happy-dom
/**
 * The viewer toolbar on a narrow screen. At 390px the seven controls did not fit on one line: the lightbox let
 * them shrink, so "Set cover" ran into its neighbour, and the targets were small. The narrow variant wraps onto a
 * second row, never shrinks or breaks a label, and makes every target 44px. The wide toolbar is unchanged.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MediaViewer, MediaViewerToolbar } from "./MediaViewer";
import type { GalleryPhoto } from "../../shared/inspection-media";

const lightboxProps = vi.hoisted(() => ({ last: null as null | { toolbarWrap?: boolean } }));
vi.mock("./PhotoLightbox", () => ({
  PhotoLightbox: (props: { toolbarWrap?: boolean; toolbarButtons?: React.ReactNode[] }) => {
    lightboxProps.last = props;
    return <div data-testid="lightbox">{props.toolbarButtons}</div>;
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  lightboxProps.last = null;
});

const NARROW = ["min-h-11", "min-w-11", "whitespace-nowrap", "shrink-0"];
const buttons = () => screen.getAllByRole("button");

describe("MediaViewerToolbar compact", () => {
  it.each(["photo", "video"] as const)("%s: every button is a 44px target that keeps its label on one line and never shrinks", (kind) => {
    render(<MediaViewerToolbar kind={kind} edited compact on={() => {}} />);
    expect(buttons().length).toBeGreaterThanOrEqual(4);
    for (const b of buttons()) for (const c of NARROW) expect(b.className, b.textContent ?? "").toContain(c);
  });

  it("the wide toolbar is unchanged: the plain lightbox button class and nothing else", () => {
    render(<MediaViewerToolbar kind="photo" edited on={() => {}} />);
    for (const b of buttons()) expect(b.className).toBe("yarl__button");
  });

  it("compact keeps the same actions in the same order", () => {
    const { unmount } = render(<MediaViewerToolbar kind="photo" edited on={() => {}} />);
    const wide = buttons().map((b) => b.textContent);
    unmount();
    render(<MediaViewerToolbar kind="photo" edited compact on={() => {}} />);
    expect(buttons().map((b) => b.textContent)).toEqual(wide);
  });
});

function stubWidth(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const limit = Number(/max-width:\s*([\d.]+)px/.exec(query)?.[1] ?? "-1");
    return { matches: width <= limit, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null };
  });
}
const photo = { key: "k1", url: "/p.jpg", label: "Roof", itemId: "roof", photoIndex: 0 } as GalleryPhoto;
const show = () => render(<MediaViewer photos={[photo]} index={0} onClose={() => {}} onAction={() => {}} />);

describe("MediaViewer picks the variant from the viewport", () => {
  it.each([320, 375, 390, 414, 480])("at %ipx the toolbar wraps and its buttons are the narrow ones", (width) => {
    stubWidth(width);
    show();
    expect(lightboxProps.last?.toolbarWrap).toBe(true);
    for (const b of buttons()) expect(b.className).toContain("min-h-11");
  });

  it.each([481, 768, 1280])("at %ipx nothing changes", (width) => {
    stubWidth(width);
    show();
    expect(lightboxProps.last?.toolbarWrap).toBeFalsy();
    for (const b of buttons()) expect(b.className).toBe("yarl__button");
  });
});
