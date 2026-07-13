import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RatingSegment } from "./RatingSegment";

afterEach(cleanup);

const ratings = [
  { value: "ok", label: "Serviceable", tone: "ok" as const },
  { value: "bad", label: "Deficient", tone: "bad" as const },
];

describe("RatingSegment", () => {
  it("selected tile is filled with its tone token", () => {
    render(<RatingSegment ratings={ratings} value="bad" onChange={() => {}} />);
    const sel = screen.getByRole("radio", { name: "Deficient" });
    expect(sel.getAttribute("aria-checked")).toBe("true");
    expect(sel.className).toContain("bg-ih-bad");
  });

  it("clicking a tile calls onChange with its value", () => {
    const onChange = vi.fn();
    render(<RatingSegment ratings={ratings} value="ok" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Deficient" }));
    expect(onChange).toHaveBeenCalledWith("bad");
  });

  it("unselected tiles are outlined/muted, not filled", () => {
    render(<RatingSegment ratings={ratings} value="bad" onChange={() => {}} />);
    const idle = screen.getByRole("radio", { name: "Serviceable" });
    expect(idle.getAttribute("aria-checked")).toBe("false");
    expect(idle.className).not.toContain("bg-ih-ok text-ih-fg-inverse");
    expect(idle.className).toContain("bg-ih-ok-bg");
  });

  it("maps the warn tone to the ih-watch token (no ih-warn token exists)", () => {
    render(
      <RatingSegment
        ratings={[{ value: "w", label: "Monitor", tone: "warn" as const }]}
        value="w"
        onChange={() => {}}
      />
    );
    expect(screen.getByRole("radio", { name: "Monitor" }).className).toContain("bg-ih-watch");
  });

  it("maps the neutral tone to a solid inverse chip when selected (contrast fix)", () => {
    render(
      <RatingSegment
        ratings={[{ value: "n", label: "N/A", tone: "neutral" as const }]}
        value="n"
        onChange={() => {}}
      />
    );
    const tile = screen.getByRole("radio", { name: "N/A" });
    expect(tile.className).toContain("bg-ih-bg-inverse");
    expect(tile.className).not.toContain("bg-ih-bg-muted");
  });

  it("only the selected tile is tab-focusable (roving tabindex)", () => {
    render(<RatingSegment ratings={ratings} value="bad" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Serviceable" }).getAttribute("tabIndex")).toBe("-1");
    expect(screen.getByRole("radio", { name: "Deficient" }).getAttribute("tabIndex")).toBe("0");
  });

  it("ArrowRight moves selection to the next tile and calls onChange", () => {
    const onChange = vi.fn();
    render(<RatingSegment ratings={ratings} value="ok" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Serviceable" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("bad");
  });

  it("Home / End jump to the first / last tile", () => {
    const onChange = vi.fn();
    const three = [
      { value: "a", label: "A", tone: "ok" as const },
      { value: "b", label: "B", tone: "warn" as const },
      { value: "c", label: "C", tone: "bad" as const },
    ];
    render(<RatingSegment ratings={three} value="b" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "B" }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("c");
    fireEvent.keyDown(screen.getByRole("radio", { name: "B" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("a per-option color override wins over the tone token, regardless of selection (BatchActionBar case)", () => {
    render(
      <RatingSegment
        ratings={[{ value: "x", label: "1", tone: "bad" as const, color: "#ff8800" }]}
        value=""
        onChange={() => {}}
      />
    );
    const tile = screen.getByRole("radio", { name: "1" });
    expect(tile.getAttribute("style")).toContain("background: #ff8800");
    expect(tile.className).not.toContain("bg-ih-bad");
  });

  it("size=sm renders the shortLabel instead of the full label", () => {
    render(
      <RatingSegment
        ratings={[{ value: "ok", label: "Serviceable", shortLabel: "OK", tone: "ok" as const }]}
        value="ok"
        onChange={() => {}}
        size="sm"
      />
    );
    // Accessible name stays the full label even when the visible text is abbreviated.
    const tile = screen.getByRole("radio", { name: "Serviceable" });
    expect(tile.textContent).toContain("OK");
    expect(tile.textContent).not.toContain("Serviceable");
  });

  it("size=md renders a responsive short/full label swap, still findable by full-label accessible name", () => {
    render(
      <RatingSegment
        ratings={[{ value: "ok", label: "Serviceable", shortLabel: "OK", tone: "ok" as const }]}
        value="ok"
        onChange={() => {}}
        size="md"
      />
    );
    // Full label remains the accessible name at every viewport.
    const tile = screen.getByRole("radio", { name: "Serviceable" });
    expect(tile.textContent).toContain("OK");
    expect(tile.textContent).toContain("Serviceable");

    const shortSpan = Array.from(tile.querySelectorAll("span")).find(
      (el) => el.textContent === "OK"
    );
    const fullSpan = Array.from(tile.querySelectorAll("span")).find(
      (el) => el.textContent === "Serviceable"
    );
    expect(shortSpan?.className).toContain("sm:hidden");
    expect(fullSpan?.className).toContain("hidden");
    expect(fullSpan?.className).toContain("sm:inline");
  });
});
