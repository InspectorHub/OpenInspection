// @vitest-environment happy-dom
/**
 * A video's toolbar offers what works on a video: caption and delete, and for a Stream clip the poster-frame picker. A video is
 * never the report cover (the cover is a still), and an R2 clip's poster is the frame captured at upload, not a picker.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MediaViewerToolbar } from "./MediaViewer";

const names = () => screen.getAllByRole("button").map((b) => b.textContent);

describe("MediaViewerToolbar for a video", () => {
  it("R2 clip: caption and delete only", () => {
    render(<MediaViewerToolbar kind="video" provider="r2" edited={false} on={() => {}} />);
    expect(names()).toEqual(["Caption", "Delete"]);
  });

  it("Stream clip: keeps its poster-frame picker, still no cover", () => {
    render(<MediaViewerToolbar kind="video" provider="stream" edited={false} on={() => {}} />);
    expect(names()).toEqual(["Poster frame", "Caption", "Delete"]);
  });

  it("a legacy video entry with no provider is a Stream clip", () => {
    render(<MediaViewerToolbar kind="video" edited={false} on={() => {}} />);
    expect(names()).toContain("Poster frame");
    expect(names()).not.toContain("Set cover");
  });

  it("control: a photo still offers Set cover", () => {
    render(<MediaViewerToolbar kind="photo" edited={false} on={() => {}} />);
    expect(names()).toContain("Set cover");
  });
});
