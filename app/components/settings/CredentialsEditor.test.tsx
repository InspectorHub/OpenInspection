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
import { render, screen } from "@testing-library/react";
import { CredentialsEditor, type EditorCredential } from "./CredentialsEditor";

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
