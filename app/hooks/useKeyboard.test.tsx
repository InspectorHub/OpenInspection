// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useLayer } from "@core/shared-ui";
import { useKeyboard, type KeyboardHandlers } from "./useKeyboard";

afterEach(cleanup);

function handlers(over: Partial<KeyboardHandlers> = {}): KeyboardHandlers {
  return {
    onRate: vi.fn(),
    onClearRating: vi.fn(),
    onNARating: vi.fn(),
    onNextItem: vi.fn(),
    onPrevItem: vi.fn(),
    onToggleSpeed: vi.fn(),
    speedMode: false,
    onOpenLibrary: vi.fn(),
    onOpenSnippets: vi.fn(),
    showCommentLibrary: false,
    onPhoto: vi.fn(),
    onSave: vi.fn(),
    onPublish: vi.fn(),
    onCloneLast: vi.fn(),
    onSaveAsSnippet: vi.fn(),
    onToggleCheatsheet: vi.fn(),
    onGotoSection: vi.fn(),
    onOpenSectionPicker: vi.fn(),
    onOpenTagPicker: vi.fn(),
    onToggleFullscreen: vi.fn(),
    onExitFullscreen: vi.fn(),
    ...over,
  };
}

// useKeyboard's window listener is registered BEFORE the layer's, the order that
// made a defaultPrevented check alone insufficient.
function Harness({ h, layerOpen }: { h: KeyboardHandlers; layerOpen: boolean }) {
  useKeyboard(h);
  useLayer(layerOpen, { onEscape: () => {} });
  return null;
}

describe("useKeyboard Escape", () => {
  it("exits fullscreen on Escape when no overlay is open", () => {
    const h = handlers();
    render(<Harness h={h} layerOpen={false} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(h.onExitFullscreen).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape to an open overlay instead of also exiting fullscreen", () => {
    const h = handlers();
    render(<Harness h={h} layerOpen />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(h.onExitFullscreen).not.toHaveBeenCalled();
  });

  it("still handles other keys while an overlay is open", () => {
    const h = handlers();
    render(<Harness h={h} layerOpen />);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(h.onSave).toHaveBeenCalledTimes(1);
  });
});
