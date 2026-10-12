// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { Modal } from "@core/shared-ui";

afterEach(cleanup);

/** A form dialog with a second dialog stacked over it, like the human check over Publish. */
function Stack({ onCloseBottom, onCloseTop, top = true }: { onCloseBottom: () => void; onCloseTop: () => void; top?: boolean }) {
  return (
    <>
      <Modal open title="Bottom" onClose={onCloseBottom}>
        <button type="button">bottom-a</button>
        <button type="button">bottom-b</button>
      </Modal>
      <Modal open={top} title="Top" onClose={onCloseTop}>
        <button type="button">top-a</button>
        <button type="button">top-b</button>
      </Modal>
    </>
  );
}

describe("stacked dialogs", () => {
  it("Escape closes only the topmost dialog", () => {
    const bottom = vi.fn();
    const top = vi.fn();
    render(<Stack onCloseBottom={bottom} onCloseTop={top} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(top).toHaveBeenCalledTimes(1);
    expect(bottom).not.toHaveBeenCalled();
  });

  it("hands the keyboard back to the dialog underneath once the top one closes", () => {
    const bottom = vi.fn();
    const top = vi.fn();
    const { rerender } = render(<Stack onCloseBottom={bottom} onCloseTop={top} />);
    rerender(<Stack onCloseBottom={bottom} onCloseTop={top} top={false} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(bottom).toHaveBeenCalledTimes(1);
    expect(top).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the topmost dialog: from its last control it wraps to its own first, not the one underneath", () => {
    render(<Stack onCloseBottom={() => {}} onCloseTop={() => {}} />);
    const topDialog = screen.getByText("Top").closest('[role="dialog"]') as HTMLElement;
    const last = screen.getByText("top-b");
    last.focus();
    const wasPrevented = !fireEvent.keyDown(last, { key: "Tab" });
    expect(wasPrevented).toBe(true);
    expect(topDialog.contains(document.activeElement)).toBe(true);
  });

  it("keeps the page locked until the LAST dialog closes, whatever order they close in", () => {
    const { rerender, unmount } = render(<Stack onCloseBottom={() => {}} onCloseTop={() => {}} />);
    expect(document.body.style.overflow).toBe("hidden");
    rerender(<Stack onCloseBottom={() => {}} onCloseTop={() => {}} top={false} />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
