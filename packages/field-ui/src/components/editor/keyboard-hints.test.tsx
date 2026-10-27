// @vitest-environment happy-dom
/** Keyboard hints (Z, Esc, J/K, the Shortcuts button) mean nothing on a phone or a bare tablet: they show only when a fine, hovering pointer exists. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import { m } from "../../i18n";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import { FooterBar } from "./FooterBar";
import { InspectorToolsDock } from "./InspectorToolsDock";
import { ItemPaneEmptyState } from "./ItemPaneEmptyState";
import { SpeedMode } from "./SpeedMode";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function pointer(fine: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("any-pointer: fine") ? fine : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}
const withDs = (ui: React.ReactNode) => <FieldDataSourceProvider dataSource={createFakeDataSource({ data: createEmptyEditorData() })}>{ui}</FieldDataSourceProvider>;

describe.each([[true], [false]])("fine pointer = %s", (fine) => {
  const shown = (v: boolean) => (fine ? v : !v);

  it("the Shortcuts button in the footer", () => {
    pointer(fine);
    render(withDs(<FooterBar status="connected" />));
    expect(!!screen.queryByRole("button", { name: new RegExp(m.editor_shortcuts_label()) })).toBe(shown(true));
  });

  it("the Shortcuts entry in the tools dock", () => {
    pointer(fine);
    render(withDs(<InspectorToolsDock activeItemId="i1" />));
    fireEvent.click(screen.getByRole("button", { name: m.editor_dock_open() }));
    expect(!!screen.queryByRole("menuitem", { name: new RegExp(m.editor_shortcuts_label()) })).toBe(shown(true));
  });

  it("the J / K hint in the empty item pane", () => {
    pointer(fine);
    render(withDs(<ItemPaneEmptyState items={[{ id: "a", label: "A" }]} isRated={() => false} onOpenItem={vi.fn()} />));
    expect(!!screen.queryByText("J", { selector: "kbd" })).toBe(shown(true));
  });
});

describe("Speed mode", () => {
  it("shows no Z / Esc footer in a touch layout", () => {
    pointer(true);
    render(<SpeedMode item={{ id: "a", label: "A", type: "rich" }} sectionTitle="S" result={{}} finished={false} onRating={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} onExit={vi.fn()} currentIndex={0} totalCount={1} onNextItem={vi.fn()} onPrevItem={vi.fn()} onJumpTo={vi.fn()} ratingLevels={[]} sections={[]} touch />);
    expect(screen.queryByText("Esc", { selector: "kbd" })).toBeNull();
  });

  it("CONTROL - a desktop keeps its Z / Esc footer", () => {
    pointer(true);
    render(<SpeedMode item={{ id: "a", label: "A", type: "rich" }} sectionTitle="S" result={{}} finished={false} onRating={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} onExit={vi.fn()} currentIndex={0} totalCount={1} onNextItem={vi.fn()} onPrevItem={vi.fn()} onJumpTo={vi.fn()} ratingLevels={[]} sections={[]} />);
    expect(screen.getByText("Esc", { selector: "kbd" })).toBeTruthy();
  });
});
