/**
 * A refused badge upload has to say so, ON the row it was refused for.
 *
 * The uploader is a button that opens a file picker; when the server rejects
 * what comes back — a 3 MB file against the 2 MB cap is the realistic one —
 * nothing about the page changes. To the person who just chose a file that is
 * indistinguishable from a button that does nothing, which is exactly how it
 * was reported.
 *
 * A toast cannot fix it either: with three uploaders on screen, a message
 * floating at the bottom of the viewport does not say WHICH one refused.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CredentialsEditor, type EditorCredential } from "./CredentialsEditor";

/**
 * The cropper is stubbed, not rendered. What these specs are about is WHETHER
 * it opens and with WHAT settings — react-easy-crop's own behaviour is not
 * this component's contract, and its geometry is covered by crop-rotation.
 */
vi.mock("~/components/media-studio/PhotoCropper", () => ({
  PhotoCropper: (p: { outputFormat?: string; maxLongEdge?: number }) => (
    <div data-testid="cropper" data-format={p.outputFormat} data-max={String(p.maxLongEdge)} />
  ),
}));

function renderEditor(over: Partial<Parameters<typeof CredentialsEditor>[0]>) {
  return render(
    <CredentialsEditor
      credentials={[rows[0]]}
      uploadingId={null}
      uploadError={null}
      onUpload={vi.fn()}
      onAdd={vi.fn()}
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
      {...over}
    />,
  );
}

const rows: EditorCredential[] = [
  { id: "c1", label: "Licensed home inspector", memberNumber: "TX-1", imageUrl: null },
  { id: "c2", label: "InterNACHI CPI", memberNumber: null, imageUrl: null },
];

function setup(uploadError: { id: string; message: string } | null) {
  return render(
    <CredentialsEditor
      credentials={rows}
      uploadingId={null}
      uploadError={uploadError}
      onUpload={vi.fn()}
      onAdd={vi.fn()}
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
}

describe("CredentialsEditor — upload refusals", () => {
  it("says nothing when nothing was refused", () => {
    const { container } = setup(null);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });

  it("shows the reason the server gave, not a generic failure", () => {
    // The API answers `{ error: { message } }`. Collapsing that to "Save failed"
    // tells the reader nothing about the limit they just broke.
    setup({ id: "c2", message: "image > 2MB" });
    expect(screen.getByRole("alert").textContent).toBe("image > 2MB");
  });

  it("puts the message on the ROW that was refused, and only that row", () => {
    const { container } = setup({ id: "c2", message: "image > 2MB" });
    const alerts = container.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    // The alert must sit in the SECOND credential's own row — with several
    // uploaders on screen, a message that is merely present is not enough.
    // Walk up from the alert and assert the row it lands in is c2's.
    let row: HTMLElement | null = alerts[0] as HTMLElement;
    while (row && !row.querySelector("input:not([type])")) row = row.parentElement;
    const labels = [...(row?.querySelectorAll("input:not([type])") ?? [])]
      .map((i) => (i as HTMLInputElement).value);
    expect(labels).toContain("InterNACHI CPI");
    expect(labels).not.toContain("Licensed home inspector");
  });
});

/**
 * A badge goes through the CROPPER, and comes out as PNG.
 *
 * It used to be the only image on this page uploaded byte-for-byte off disk —
 * no straightening a photographed certificate, no trimming the margin around a
 * seal — on the one surface whose whole purpose is appearing on a published
 * report.
 *
 * The format is the part with teeth. A badge is cut out against transparency;
 * JPEG has no alpha channel and fills it with white, so the report cover gets a
 * white rectangle where the seal should be. Nothing on the settings page would
 * show that: the preview there sits on a light card.
 */
describe("CredentialsEditor — cropping a badge", () => {
  function pick(container: HTMLElement, file: File) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
  }

  it("opens the cropper instead of uploading the raw file", () => {
    const onUpload = vi.fn();
    const { container } = renderEditor({ onUpload });
    pick(container, new File(["x"], "badge.png", { type: "image/png" }));
    expect(screen.getByTestId("cropper")).toBeTruthy();
    // Nothing is sent until the reader saves a crop.
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("bakes PNG, so a transparent badge stays transparent", () => {
    const { container } = renderEditor({});
    pick(container, new File(["x"], "badge.png", { type: "image/png" }));
    expect(screen.getByTestId("cropper").getAttribute("data-format")).toBe("image/png");
  });

  it("lets a vector badge through untouched — rasterizing it would be the downgrade", () => {
    const onUpload = vi.fn();
    const { container } = renderEditor({ onUpload });
    const svg = new File(["<svg/>"], "seal.svg", { type: "image/svg+xml" });
    pick(container, svg);
    expect(screen.queryByTestId("cropper")).toBeNull();
    expect(onUpload).toHaveBeenCalledWith("c1", svg);
  });

  it("refuses an oversized file here, before any request", () => {
    const onUpload = vi.fn();
    const { container } = renderEditor({ onUpload });
    const big = new File(["x"], "badge.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 3_000_000 });
    pick(container, big);
    expect(screen.queryByTestId("cropper")).toBeNull();
    expect(onUpload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/2 MB/i);
  });
});
