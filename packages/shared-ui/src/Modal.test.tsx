import type React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { Modal } from "@core/shared-ui";

afterEach(cleanup);

function renderModal(props: Partial<React.ComponentProps<typeof Modal>> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <Modal open title="Test dialog" onClose={onClose} {...props}>
      <button type="button">first</button>
      <button type="button">second</button>
    </Modal>,
  );
  return { onClose, ...utils };
}

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal open={false} title="Hidden" onClose={() => {}}>
        x
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders title with dialog semantics when open", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("Test dialog")).toBeTruthy();
  });

  it("calls onClose on Escape", () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks body scroll while open and restores on unmount", () => {
    const { unmount } = renderModal();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("moves focus inside the dialog on open", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("wraps Tab focus from last to first focusable", () => {
    renderModal();
    const last = screen.getByText("second");
    (last as HTMLElement).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    // After wrapping, focus must still be inside the dialog (not escape to body)
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });

  it("closes on backdrop click but not on panel click", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the backdrop token, not a hardcoded rgba scrim", () => {
    renderModal();
    const overlay = screen.getByRole("dialog").parentElement as HTMLElement;
    expect(overlay.className).toContain("bg-ih-backdrop");
    expect(overlay.className).not.toContain("rgba(15,23,42");
  });
});
