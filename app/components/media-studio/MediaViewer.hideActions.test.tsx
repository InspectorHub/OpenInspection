// @vitest-environment happy-dom
/**
 * The photo drawer's viewer used to show every toolbar action while its parent
 * wired only two of them (cover, annotate). Delete, crop, rotate, caption,
 * revert and poster were buttons that closed the viewer and did nothing. The
 * drawer now says which actions it does not handle and the toolbar leaves them
 * out; the editor's own viewer, which wires them all, is unchanged.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MediaViewerToolbar, type MediaAction } from "@core/field-ui/components/media-studio/MediaViewer";
import { GALLERY_UNHANDLED_ACTIONS } from "./PhotoGallery";

const names = () => screen.getAllByRole("button").map((b) => b.textContent);

describe("MediaViewerToolbar hidden actions", () => {
  it("CONTROL: with nothing hidden a photo shows Delete, Crop and Annotate", () => {
    render(<MediaViewerToolbar kind="photo" edited={false} on={() => {}} />);
    expect(names()).toEqual(expect.arrayContaining(["Delete", "Crop", "Annotate", "Set cover"]));
  });

  it("leaves out each action it is told to hide, and keeps the rest", () => {
    render(<MediaViewerToolbar kind="photo" edited hide={["delete", "crop"]} on={() => {}} />);
    expect(names()).not.toContain("Delete");
    expect(names()).not.toContain("Crop");
    expect(names()).toEqual(expect.arrayContaining(["Annotate", "Set cover", "Revert"]));
  });

  it("hides video actions too", () => {
    render(<MediaViewerToolbar kind="video" edited={false} hide={["delete", "poster", "caption"]} on={() => {}} />);
    expect(names()).toEqual(["Set cover"]);
  });

  it("the photo drawer hides every action it does not wire, and only those", () => {
    const wired: MediaAction[] = ["cover", "annotate"];
    const all: MediaAction[] = ["crop", "annotate", "rotate", "cover", "caption", "revert", "delete", "poster"];
    expect([...GALLERY_UNHANDLED_ACTIONS].sort()).toEqual(all.filter((a) => !wired.includes(a)).sort());
  });
});
