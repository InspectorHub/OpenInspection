// @vitest-environment happy-dom
/**
 * Speed mode on a touch layout (phone and tablet): the rating row sits at the bottom within thumb reach with
 * 56px targets, the overlay respects the safe area and the dynamic viewport, and a long title wraps instead of
 * scrolling. The desktop markup is untouched, and an undo outlives the item change a rating causes.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { SpeedMode } from "./SpeedMode";
import { m } from "../../i18n";

const LEVELS = [
  { id: "ok", label: "Satisfactory", severity: "good" },
  { id: "mon", label: "Monitor", severity: "marginal" },
  { id: "def", label: "Defect", severity: "significant" },
];

const base = {
  item: { id: "i1", label: "Flashing condition", type: "rich" },
  sectionTitle: "Roofing",
  result: {},
  onRating: () => {},
  onPrev: () => {},
  onNext: () => {},
  onExit: () => {},
  currentIndex: 0,
  totalCount: 3,
  ratingLevels: LEVELS,
};

beforeEach(() => localStorage.setItem("oi:speedmode-coached", "1"));
afterEach(cleanup);

const root = () => screen.getByRole("dialog", { name: m.editor_speedmode_aria_label() });

describe("SpeedMode touch layout", () => {
  it("desktop markup is unchanged: no dynamic-viewport or safe-area classes, 80px tiles", () => {
    render(<SpeedMode {...base} />);
    expect(root().className).toBe("fixed inset-0 z-[100] bg-ih-bg-card flex flex-col");
    expect(screen.getByRole("button", { name: /Defect/ }).className).toContain("w-20 h-20");
    expect(screen.queryByTestId("speedmode-ratings")).toBeNull();
  });

  it("touch: dynamic viewport height and both safe-area insets on the overlay", () => {
    render(<SpeedMode {...base} touch />);
    const cls = root().className;
    expect(cls).toContain("h-dvh");
    expect(cls).toContain("pt-[env(safe-area-inset-top)]");
    expect(cls).toContain("pb-[max(1rem,env(safe-area-inset-bottom))]");
    expect(cls).not.toContain("h-screen");
  });

  it("touch: the rating row is a bottom row of tiles at least 56px high, one per level", () => {
    render(<SpeedMode {...base} touch />);
    const row = screen.getByTestId("speedmode-ratings");
    const tiles = Array.from(row.querySelectorAll("button"));
    expect(tiles).toHaveLength(LEVELS.length);
    for (const t of tiles) {
      expect(t.className).toContain("min-h-14");
      expect(t.className).toContain("touch-manipulation");
      expect(t.className).not.toContain("w-20");
    }
    // The row is the last block above the footer hint: it comes after the gesture surface in the document.
    const title = screen.getByRole("heading", { level: 2 });
    expect(title.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.className).toContain("gap-2");
    expect(row.className).toContain("flex-wrap");
  });

  it("touch: a long title wraps on two lines at most and never forces a horizontal scroll", () => {
    render(<SpeedMode {...base} touch item={{ ...base.item, label: "Roof-mounted solar panel array mounting hardware and flashing condition" }} sectionTitle="Roofing and attic ventilation systems" />);
    const title = screen.getByRole("heading", { level: 2 });
    expect(title.className).toContain("line-clamp-2");
    expect(title.className).toContain("min-w-0");
    expect(title.className).toContain("break-words");
    expect(screen.getByText("Roofing and attic ventilation systems").className).toContain("truncate");
  });
});

describe("SpeedMode rating and undo", () => {
  it("advanceOnRate={false}: a rating tap does not call onNext (the host already moved the cursor)", () => {
    const onNext = vi.fn();
    const onRating = vi.fn();
    render(<SpeedMode {...base} touch onNext={onNext} onRating={onRating} advanceOnRate={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Defect/ }));
    expect(onRating).toHaveBeenCalledWith("def");
    expect(onNext).not.toHaveBeenCalled();
  });

  it("CONTROL: by default a rating tap still advances", () => {
    const onNext = vi.fn();
    render(<SpeedMode {...base} onNext={onNext} />);
    fireEvent.click(screen.getByRole("button", { name: /Defect/ }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("with onUndoRating, Undo reverts the item that was rated even after the item on screen changed", () => {
    const onUndoRating = vi.fn();
    const { rerender } = render(<SpeedMode {...base} onUndoRating={onUndoRating} />);
    fireEvent.click(screen.getByRole("button", { name: /Defect/ }));
    // The host removes the rated item from the queue, so the next item is on screen when the toast shows.
    rerender(<SpeedMode {...base} item={{ id: "i2", label: "Gutter", type: "rich" }} onUndoRating={onUndoRating} />);
    fireEvent.click(screen.getByRole("button", { name: m.common_undo() }));
    expect(onUndoRating).toHaveBeenCalledWith("i1", null);
  });

  it("CONTROL: without onUndoRating the toast is still cleared by an item change (the old behaviour)", () => {
    const { rerender } = render(<SpeedMode {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /Defect/ }));
    expect(screen.queryByRole("button", { name: m.common_undo() })).not.toBeNull();
    rerender(<SpeedMode {...base} item={{ id: "i2", label: "Gutter", type: "rich" }} />);
    expect(screen.queryByRole("button", { name: m.common_undo() })).toBeNull();
  });

  it("the previous rating is what Undo restores", () => {
    const onUndoRating = vi.fn();
    render(<SpeedMode {...base} result={{ rating: "mon" }} onUndoRating={onUndoRating} />);
    fireEvent.click(screen.getByRole("button", { name: /Defect/ }));
    act(() => {});
    fireEvent.click(screen.getByRole("button", { name: m.common_undo() }));
    expect(onUndoRating).toHaveBeenCalledWith("i1", "mon");
  });
});

describe("SpeedMode toast placement and state", () => {
  it("touch: the Undo toast is a row in the flow, above the rating tiles, never over them", () => {
    render(<SpeedMode {...base} touch onUndoRating={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Defect/ }));
    const undo = screen.getByRole("button", { name: m.common_undo() });
    const toast = undo.parentElement as HTMLElement;
    expect(toast.className).not.toContain("fixed");
    const tiles = screen.getByTestId("speedmode-ratings");
    // Same parent, toast first: it can only ever take space, not cover the tiles.
    expect(toast.parentElement).toBe(tiles.parentElement);
    expect(toast.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("desktop: the toast is still the floating one", () => {
    render(<SpeedMode {...base} onUndoRating={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Defect/ }));
    expect(screen.getByRole("button", { name: m.common_undo() }).parentElement!.className).toContain("fixed");
  });

  it("finished: says everything is rated, offers no tiles, and the last rating can still be undone", () => {
    const onUndoRating = vi.fn();
    const { rerender } = render(<SpeedMode {...base} touch onUndoRating={onUndoRating} />);
    fireEvent.click(screen.getByRole("button", { name: /Defect/ }));
    rerender(<SpeedMode {...base} touch finished onUndoRating={onUndoRating} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(m.editor_speedmode_all_rated());
    expect(screen.queryByTestId("speedmode-ratings")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: m.common_undo() }));
    expect(onUndoRating).toHaveBeenCalledWith("i1", null);
  });

  it("a cleared rating stored as an empty string is undone to null, not ''", () => {
    const onUndoRating = vi.fn();
    render(<SpeedMode {...base} result={{ rating: "" }} onUndoRating={onUndoRating} />);
    fireEvent.click(screen.getByRole("button", { name: /Defect/ }));
    fireEvent.click(screen.getByRole("button", { name: m.common_undo() }));
    expect(onUndoRating).toHaveBeenCalledWith("i1", null);
  });

  it("host-held toast state survives a remount of the overlay", () => {
    const store: { value: Parameters<NonNullable<React.ComponentProps<typeof SpeedMode>["onPendingUndoChange"]>>[0] } = { value: null };
    const props = () => ({ ...base, onUndoRating: () => {}, pendingUndo: store.value, onPendingUndoChange: (u: typeof store.value) => { store.value = u; } });
    const first = render(<SpeedMode {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /Defect/ }));
    expect(store.value).not.toBeNull();
    first.unmount();
    render(<SpeedMode {...props()} touch />);
    expect(screen.getByRole("button", { name: m.common_undo() })).toBeTruthy();
  });
});
