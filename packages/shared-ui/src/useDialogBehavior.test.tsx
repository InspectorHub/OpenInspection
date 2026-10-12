// @vitest-environment happy-dom
import React, { useEffect, useRef } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";
import { Modal, useLayer } from "@core/shared-ui";
import { useDialogBehavior } from "./useDialogBehavior";

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

  it("does not pull focus out of the top dialog when the one underneath closes", () => {
    const { rerender } = render(<Stack onCloseBottom={() => {}} onCloseTop={() => {}} />);
    screen.getByText("top-b").focus();
    // The bottom dialog goes away while the top stays open.
    rerender(
      <Modal open title="Top" onClose={() => {}}>
        <button type="button">top-a</button>
        <button type="button">top-b</button>
      </Modal>,
    );
    expect(screen.getByText("Top").closest('[role="dialog"]')!.contains(document.activeElement)).toBe(true);
  });

  it("removes a dialog that unmounts while open, so the one underneath answers Escape again", () => {
    const bottom = vi.fn();
    const { rerender } = render(<Stack onCloseBottom={bottom} onCloseTop={() => {}} />);
    rerender(<Stack onCloseBottom={bottom} onCloseTop={() => {}} top={false} />);
    rerender(<Stack onCloseBottom={bottom} onCloseTop={() => {}} top />);
    rerender(<Stack onCloseBottom={bottom} onCloseTop={() => {}} top={false} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(bottom).toHaveBeenCalledTimes(1);
  });

  it("leaves the dialog open when something inside it already used Escape", () => {
    const top = vi.fn();
    render(<Stack onCloseBottom={() => {}} onCloseTop={top} />);
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    event.preventDefault();
    document.dispatchEvent(event);
    expect(top).not.toHaveBeenCalled();
  });
});

// Bare dialog on the hook itself, so tests control exactly what sits inside the root.
function Dlg({ open, children }: { open: boolean; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehavior(open, () => {}, ref);
  return open ? (
    <div ref={ref} role="dialog" aria-label="d" tabIndex={-1}>
      {children}
    </div>
  ) : null;
}

const flush = () => act(async () => {});

function Page({ open, children, extra }: { open: boolean; children?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <>
      <main data-testid="main" />
      {extra}
      <button data-testid="trigger">open</button>
      <button data-testid="row">row</button>
      <Dlg open={open}>{children ?? <button>first</button>}</Dlg>
    </>
  );
}

const trigger = () => screen.getByTestId("trigger");

function openFromTrigger(props: Partial<React.ComponentProps<typeof Page>> = {}) {
  const view = render(<Page open={false} {...props} />);
  trigger().focus();
  view.rerender(<Page open {...props} />);
  return { view, props };
}

describe("opener capture", () => {
  function SelfFocus() {
    const r = useRef<HTMLButtonElement>(null);
    // Child effects run before the hook's own effect in the parent.
    useEffect(() => r.current?.focus(), []);
    return <button ref={r}>self</button>;
  }

  it("a child that focuses itself on mount does not become the recorded opener", async () => {
    const view = render(<Page open={false}>{<SelfFocus />}</Page>);
    trigger().focus();
    view.rerender(<Page open>{<SelfFocus />}</Page>);
    expect(document.activeElement).toBe(screen.getByText("self"));
    view.rerender(<Page open={false}>{<SelfFocus />}</Page>);
    await flush();
    expect(document.activeElement).toBe(trigger());
  });

  it("positive control: a plain dialog restores the trigger", async () => {
    const { view } = openFromTrigger();
    view.rerender(<Page open={false} />);
    await flush();
    expect(document.activeElement).toBe(trigger());
  });
});

describe("restore does not override a deliberate focus move", () => {
  it("synchronous path: focus moved to another control before closing stays there", async () => {
    const { view } = openFromTrigger();
    screen.getByTestId("row").focus();
    view.rerender(<Page open={false} />);
    await flush();
    expect(document.activeElement).toBe(screen.getByTestId("row"));
  });

  it("positive control: focus still inside the dialog is restored synchronously", () => {
    const { view } = openFromTrigger();
    expect(document.activeElement).toBe(screen.getByText("first"));
    view.rerender(<Page open={false} />);
    expect(document.activeElement).toBe(trigger());
  });
});

describe("restore target must be able to take focus", () => {
  async function closeAfter(mutate: () => void, props: Partial<React.ComponentProps<typeof Page>> = {}) {
    const { view } = openFromTrigger(props);
    mutate();
    view.rerender(<Page open={false} {...props} />);
    await flush();
  }

  it("aria-disabled trigger falls through to main", async () => {
    await closeAfter(() => trigger().setAttribute("aria-disabled", "true"));
    expect(document.activeElement).toBe(screen.getByTestId("main"));
  });

  it("trigger under [inert] falls through to main", async () => {
    const { view } = openFromTrigger();
    const wrap = document.createElement("div");
    wrap.setAttribute("inert", "");
    const t = trigger();
    t.parentNode!.insertBefore(wrap, t);
    wrap.appendChild(t);
    view.rerender(<Page open={false} />);
    await flush();
    expect(document.activeElement).toBe(screen.getByTestId("main"));
    wrap.replaceWith(...Array.from(wrap.childNodes));
  });

  it("display:none and visibility:hidden triggers fall through to main", async () => {
    await closeAfter(() => (trigger().style.display = "none"));
    expect(document.activeElement).toBe(screen.getByTestId("main"));
    cleanup();
    await closeAfter(() => (trigger().style.visibility = "hidden"));
    expect(document.activeElement).toBe(screen.getByTestId("main"));
  });

  it("a trigger whose focus() does not land falls through to [data-focus-fallback]", async () => {
    const extra = <div data-testid="fallback" data-focus-fallback tabIndex={-1} />;
    await closeAfter(
      () => {
        trigger().focus = () => {};
      },
      { extra },
    );
    expect(document.activeElement).toBe(screen.getByTestId("fallback"));
  });

  it("a disabled fallback is skipped for main; an enabled fallback beats main", async () => {
    const bad = <div data-testid="fallback" data-focus-fallback tabIndex={-1} aria-disabled="true" />;
    await closeAfter(() => (trigger().style.display = "none"), { extra: bad });
    expect(document.activeElement).toBe(screen.getByTestId("main"));
    cleanup();
    const good = <div data-testid="fallback" data-focus-fallback tabIndex={-1} />;
    await closeAfter(() => (trigger().style.display = "none"), { extra: good });
    expect(document.activeElement).toBe(screen.getByTestId("fallback"));
  });

  it("main gets tabindex=-1 only when it has none, and loses it on blur; its own is kept", async () => {
    await closeAfter(() => (trigger().style.display = "none"));
    const main = screen.getByTestId("main");
    expect(document.activeElement).toBe(main);
    expect(main.getAttribute("tabindex")).toBe("-1");
    screen.getByTestId("row").focus();
    expect(main.hasAttribute("tabindex")).toBe(false);
    cleanup();

    function Own({ open }: { open: boolean }) {
      return (
        <>
          <main data-testid="main" tabIndex={0} />
          <button data-testid="trigger">open</button>
          <button data-testid="row">row</button>
          <Dlg open={open} />
        </>
      );
    }
    const v = render(<Own open={false} />);
    trigger().focus();
    v.rerender(<Own open />);
    trigger().style.display = "none";
    v.rerender(<Own open={false} />);
    await flush();
    expect(document.activeElement).toBe(screen.getByTestId("main"));
    screen.getByTestId("row").focus();
    expect(screen.getByTestId("main").getAttribute("tabindex")).toBe("0");
  });

  it("main whose focus() fails does not keep an added tabindex", async () => {
    const { view } = openFromTrigger();
    const main = screen.getByTestId("main");
    main.focus = () => {};
    trigger().style.display = "none";
    view.rerender(<Page open={false} />);
    await flush();
    expect(main.hasAttribute("tabindex")).toBe(false);
  });

  it("with no trigger, fallback or main, focus is left alone", async () => {
    function Bare({ open }: { open: boolean }) {
      return (
        <>
          <button data-testid="trigger">open</button>
          <Dlg open={open} />
        </>
      );
    }
    const view = render(<Bare open={false} />);
    trigger().focus();
    view.rerender(<Bare open />);
    trigger().style.display = "none";
    view.rerender(<Bare open={false} />);
    await flush();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("focusable filtering", () => {
  it("initial focus skips input[type=hidden], [hidden], display:none and disabled nodes", () => {
    render(
      <Dlg open>
        <input type="hidden" name="csrf" />
        <div hidden>
          <button>hidden-wrapped</button>
        </div>
        <button style={{ display: "none" }}>gone</button>
        <button disabled>off</button>
        <button>real</button>
      </Dlg>,
    );
    expect(document.activeElement).toBe(screen.getByText("real"));
  });

  it("skips nodes inside an [inert] ancestor for initial focus", () => {
    render(
      <Dlg open>
        <div inert={true}>
          <button>inert-wrapped</button>
        </div>
        <button>real</button>
      </Dlg>,
    );
    expect(document.activeElement).toBe(screen.getByText("real"));
  });

  it("Tab wraps between rendered controls only (hidden input first, hidden buttons last)", () => {
    render(
      <Dlg open>
        <input type="hidden" name="csrf" />
        <button>first</button>
        <button>last</button>
        <button style={{ visibility: "hidden" }}>invisible</button>
        <button hidden>hidden-last</button>
      </Dlg>,
    );
    const first = screen.getByText("first");
    const last = screen.getByText("last");
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });
});

describe("tab stops beyond buttons and links", () => {
  it("a contenteditable as the last tabbable keeps the trap: Tab from it wraps to the first", () => {
    render(
      <Dlg open>
        <button>first</button>
        <div contentEditable suppressContentEditableWarning data-testid="editor">notes</div>
      </Dlg>,
    );
    const editor = screen.getByTestId("editor");
    editor.focus();
    expect(document.activeElement).toBe(editor);
    const prevented = !fireEvent.keyDown(editor, { key: "Tab" });
    expect(prevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("contenteditable=false is not a tab stop", () => {
    render(
      <Dlg open>
        <button>first</button>
        <div contentEditable={false} data-testid="static">x</div>
        <button>last</button>
      </Dlg>,
    );
    const last = screen.getByText("last");
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("a summary as the last tabbable keeps the trap", () => {
    render(
      <Dlg open>
        <button>first</button>
        <details>
          <summary data-testid="summary">more</summary>
        </details>
      </Dlg>,
    );
    const summary = screen.getByTestId("summary");
    summary.focus();
    expect(document.activeElement).toBe(summary);
    fireEvent.keyDown(summary, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("first"));
  });
});

describe("a popover does not cancel a pending restore", () => {
  function Pop() {
    useLayer(true, {});
    return <span />;
  }
  function Host({ open, pop }: { open: boolean; pop: boolean }) {
    return (
      <>
        <button data-testid="trigger">open</button>
        {pop && <Pop />}
        <Dlg open={open} />
      </>
    );
  }

  it("a popover opened after the dialog is above it when it closes; the trigger still gets focus", async () => {
    const view = render(<Host open={false} pop={false} />);
    trigger().focus();
    view.rerender(<Host open pop={false} />);
    view.rerender(<Host open pop />);
    view.rerender(<Host open={false} pop />);
    await flush();
    expect(document.activeElement).toBe(trigger());
  });
});
