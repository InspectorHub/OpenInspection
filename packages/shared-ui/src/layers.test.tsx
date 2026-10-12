// @vitest-environment happy-dom
import React, { useRef } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { Modal, Drawer, Popover, useLayer, hasOpenLayer, escapeWillBeHandled } from "@core/shared-ui";
import { hasTrappingLayer } from "./layers";

/** Module state is shared across tests: unmounting everything must leave it empty. */
afterEach(() => {
  cleanup();
  expect(hasOpenLayer()).toBe(false);
  expect(document.body.style.overflow).toBe("");
});

function Probe({ open, onEscape, lockScroll }: { open: boolean; onEscape?: () => void; lockScroll?: boolean }) {
  useLayer(open, { onEscape, lockScroll });
  return null;
}

const esc = (target: Window | Document | Node | Element = document) => fireEvent.keyDown(target, { key: "Escape" });

describe("layer stack", () => {
  it("sends Escape only to the topmost layer, then back to the one underneath", () => {
    const a = vi.fn();
    const b = vi.fn();
    const { rerender } = render(
      <>
        <Probe open onEscape={a} />
        <Probe open onEscape={b} />
      </>,
    );
    esc();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    rerender(
      <>
        <Probe open onEscape={a} />
        <Probe open={false} onEscape={b} />
      </>,
    );
    esc();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("hears Escape dispatched on window as well as on document", () => {
    const a = vi.fn();
    render(<Probe open onEscape={a} />);
    esc(window);
    esc(document.body);
    expect(a).toHaveBeenCalledTimes(2);
  });

  it("ignores an Escape that something already consumed", () => {
    const a = vi.fn();
    render(<Probe open onEscape={a} />);
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    event.preventDefault();
    document.dispatchEvent(event);
    expect(a).not.toHaveBeenCalled();
  });

  it("lets a React onKeyDown widget consume Escape before the stack sees it", () => {
    const close = vi.fn();
    render(
      <>
        <Probe open onEscape={close} />
        <input
          aria-label="field"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.preventDefault();
          }}
        />
      </>,
    );
    esc(screen.getByLabelText("field"));
    expect(close).not.toHaveBeenCalled();
  });

  it("marks the Escape it handled as consumed", () => {
    render(<Probe open onEscape={() => {}} />);
    expect(esc()).toBe(false);
  });

  it("does not consume Escape for a layer without a handler", () => {
    render(<Probe open />);
    expect(esc()).toBe(true);
  });

  it("calls the latest onEscape without re-registering", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Probe open onEscape={first} />);
    rerender(<Probe open onEscape={second} />);
    esc();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("removes a layer that unmounts while open", () => {
    const a = vi.fn();
    const b = vi.fn();
    const { rerender } = render(
      <>
        <Probe open onEscape={a} />
        <Probe open onEscape={b} />
      </>,
    );
    rerender(<Probe open onEscape={a} />);
    esc();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("stays balanced under StrictMode double effects", () => {
    const a = vi.fn();
    const { unmount } = render(
      <React.StrictMode>
        <Probe open onEscape={a} lockScroll />
      </React.StrictMode>,
    );
    expect(hasOpenLayer()).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    esc();
    expect(a).toHaveBeenCalledTimes(1);
    unmount();
    expect(hasOpenLayer()).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  it("counts the scroll lock across layers, whichever closes first", () => {
    const { rerender } = render(
      <>
        <Probe open lockScroll />
        <Probe open lockScroll />
      </>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    rerender(
      <>
        <Probe open lockScroll />
        <Probe open={false} lockScroll />
      </>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    rerender(
      <>
        <Probe open={false} lockScroll />
        <Probe open={false} lockScroll />
      </>,
    );
    expect(document.body.style.overflow).toBe("");

    // Opposite order: the bottom layer closes first.
    const second = render(
      <>
        <Probe open lockScroll />
        <Probe open lockScroll />
      </>,
    );
    second.rerender(
      <>
        <Probe open={false} lockScroll />
        <Probe open lockScroll />
      </>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    second.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("restores the overflow the page had before the first lock", () => {
    document.body.style.overflow = "scroll";
    const { unmount } = render(<Probe open lockScroll />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("scroll");
    document.body.style.overflow = "";
  });

  it("does not lock scroll for a layer that did not ask", () => {
    render(<Probe open />);
    expect(document.body.style.overflow).toBe("");
  });

  it("reports escapeWillBeHandled only when the top layer answers Escape", () => {
    const { rerender } = render(<Probe open />);
    expect(hasOpenLayer()).toBe(true);
    expect(escapeWillBeHandled()).toBe(false);
    rerender(<Probe open onEscape={() => {}} />);
    expect(escapeWillBeHandled()).toBe(true);
  });

  it("does not overwrite an overflow value some other writer set while locked", () => {
    const { unmount } = render(<Probe open lockScroll />);
    document.body.style.overflow = "clip";
    unmount();
    expect(document.body.style.overflow).toBe("clip");
    document.body.style.overflow = "";
  });

  it("a layer that is not registered (invisible) takes no Escape", () => {
    const hidden = vi.fn();
    const visible = vi.fn();
    render(
      <>
        <Probe open onEscape={visible} />
        <Probe open={false} onEscape={hidden} />
      </>,
    );
    esc();
    expect(visible).toHaveBeenCalledTimes(1);
    expect(hidden).not.toHaveBeenCalled();
  });

  it("reports hasOpenLayer for non-layer hotkey handlers", () => {
    expect(hasOpenLayer()).toBe(false);
    const { rerender } = render(<Probe open />);
    expect(hasOpenLayer()).toBe(true);
    rerender(<Probe open={false} />);
    expect(hasOpenLayer()).toBe(false);
  });

  it("hasTrappingLayer ignores a non-trapping layer; hasOpenLayer does not", () => {
    function Trap({ open }: { open: boolean }) {
      useLayer(open, { traps: true });
      return null;
    }
    const { rerender } = render(<Probe open />);
    expect(hasOpenLayer()).toBe(true);
    expect(hasTrappingLayer()).toBe(false);
    rerender(
      <>
        <Probe open />
        <Trap open />
      </>,
    );
    expect(hasTrappingLayer()).toBe(true);
    rerender(<Probe open={false} />);
    expect(hasTrappingLayer()).toBe(false);
  });
});

function PopoverInModal({ onModal, onPopover, popoverOpen }: { onModal: () => void; onPopover: () => void; popoverOpen: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <Modal open title="Host" onClose={onModal}>
      <button type="button" ref={anchor}>
        anchor
      </button>
      <Popover open={popoverOpen} onClose={onPopover} anchorRef={anchor}>
        <button type="button">inside-popover</button>
      </Popover>
    </Modal>
  );
}

describe("composed overlays", () => {
  it("Escape closes only the popover inside a modal, the next one closes the modal", () => {
    const modal = vi.fn();
    const popover = vi.fn();
    // The popover opens after the modal, as a user would open it.
    const { rerender } = render(<PopoverInModal onModal={modal} onPopover={popover} popoverOpen={false} />);
    rerender(<PopoverInModal onModal={modal} onPopover={popover} popoverOpen />);
    esc();
    expect(popover).toHaveBeenCalledTimes(1);
    expect(modal).not.toHaveBeenCalled();
    rerender(<PopoverInModal onModal={modal} onPopover={popover} popoverOpen={false} />);
    esc();
    expect(modal).toHaveBeenCalledTimes(1);
    expect(popover).toHaveBeenCalledTimes(1);
  });

  it("a popover that mounts open together with its modal is still on top of it", () => {
    const modal = vi.fn();
    const popover = vi.fn();
    // Both open in the SAME commit: the child's effect runs first, so effect order alone
    // would put the popover underneath the modal that contains it.
    render(<PopoverInModal onModal={modal} onPopover={popover} popoverOpen />);
    esc();
    expect(popover).toHaveBeenCalledTimes(1);
    expect(modal).not.toHaveBeenCalled();
  });

  it("a layer that re-opens while another stays open becomes the top one", () => {
    const a = vi.fn();
    const b = vi.fn();
    const ui = (aOpen: boolean) => (
      <>
        <Probe open={aOpen} onEscape={a} />
        <Probe open onEscape={b} />
      </>
    );
    const { rerender } = render(ui(true));
    rerender(ui(false));
    rerender(ui(true));
    esc();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("a drawer over a modal takes Escape first", () => {
    const modal = vi.fn();
    const drawer = vi.fn();
    render(
      <>
        <Modal open title="Under" onClose={modal}>
          <button type="button">m</button>
        </Modal>
        <Drawer open title="Over" onClose={drawer}>
          <button type="button">d</button>
        </Drawer>
      </>,
    );
    esc();
    expect(drawer).toHaveBeenCalledTimes(1);
    expect(modal).not.toHaveBeenCalled();
  });

  it("keeps the page locked across a modal and a bottom-sheet style layer in either close order", () => {
    const ui = (modal: boolean, sheet: boolean) => (
      <>
        <Modal open={modal} title="M" onClose={() => {}}>
          <button type="button">m</button>
        </Modal>
        <Probe open={sheet} lockScroll />
      </>
    );
    const { rerender } = render(ui(true, true));
    expect(document.body.style.overflow).toBe("hidden");
    rerender(ui(false, true));
    expect(document.body.style.overflow).toBe("hidden");
    rerender(ui(true, true));
    rerender(ui(true, false));
    expect(document.body.style.overflow).toBe("hidden");
    rerender(ui(false, false));
    expect(document.body.style.overflow).toBe("");
  });

  it("wraps Tab and Shift+Tab inside the top dialog only", () => {
    render(
      <>
        <Modal open title="Under" onClose={() => {}}>
          <button type="button">u1</button>
          <button type="button">u2</button>
        </Modal>
        <Modal open title="Over" onClose={() => {}}>
          <button type="button">o1</button>
          <button type="button">o2</button>
        </Modal>
      </>,
    );
    // The header close button is each dialog's first focusable.
    const first = screen.getAllByLabelText("Close")[1];
    const o2 = screen.getByText("o2");
    o2.focus();
    expect(fireEvent.keyDown(o2, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(first);
    expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(o2);
  });

  it("does not steal focus when the bottom dialog closes while the top stays open", () => {
    const ui = (bottom: boolean) => (
      <>
        <Modal open={bottom} title="Under" onClose={() => {}}>
          <button type="button">u1</button>
        </Modal>
        <Modal open title="Over" onClose={() => {}}>
          <button type="button">o1</button>
        </Modal>
      </>
    );
    const { rerender } = render(ui(true));
    screen.getByText("o1").focus();
    rerender(ui(false));
    expect(document.activeElement).toBe(screen.getByText("o1"));
  });

  it("returns focus to the trigger when the only dialog closes", () => {
    const Host = ({ open }: { open: boolean }) => (
      <>
        <button type="button">trigger</button>
        <Modal open={open} title="M" onClose={() => {}}>
          <button type="button">in</button>
        </Modal>
      </>
    );
    const { rerender } = render(<Host open={false} />);
    screen.getByText("trigger").focus();
    rerender(<Host open />);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    rerender(<Host open={false} />);
    expect(document.activeElement).toBe(screen.getByText("trigger"));
  });

  it("leaves Tab alone for focus inside a popover above a dialog", () => {
    render(
      <>
        <Modal open title="M" onClose={() => {}}>
          <button type="button">m1</button>
        </Modal>
        <Probe open onEscape={() => {}} />
        <button type="button">outside</button>
      </>,
    );
    const outside = screen.getByText("outside");
    outside.focus();
    // A non-trapping overlay above: focus outside the dialog root is not pulled back.
    expect(fireEvent.keyDown(outside, { key: "Tab" })).toBe(true);
  });

  it("restores the trigger when parent and child dialogs close in the same commit", async () => {
    const Host = ({ open }: { open: boolean }) => (
      <>
        <button type="button">trigger</button>
        <Modal open={open} title="Outer" onClose={() => {}}>
          <Modal open={open} title="Inner" onClose={() => {}}>
            <button type="button">in</button>
          </Modal>
        </Modal>
      </>
    );
    const { rerender } = render(<Host open={false} />);
    screen.getByText("trigger").focus();
    rerender(<Host open />);
    rerender(<Host open={false} />);
    await Promise.resolve();
    expect(document.activeElement).toBe(screen.getByText("trigger"));
  });
});
