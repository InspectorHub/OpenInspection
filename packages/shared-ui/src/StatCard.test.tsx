import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { StatCard } from "@core/shared-ui";

afterEach(cleanup);

describe("StatCard", () => {
  it("renders the label and value", () => {
    render(<StatCard label="TOTAL" value={42} />);
    expect(screen.getByText("TOTAL")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("is a flat bordered card when no tone is given", () => {
    const { container } = render(<StatCard label="TOTAL" value="7" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("bg-ih-bg-card");
    expect(root.className).toContain("rounded-ih-card");
    // flat variant uses a full border, not a left accent
    expect(root.className).toContain("border-ih-border");
    expect(root.className).not.toContain("border-l-4");
  });

  it("applies a left-accent border in the tone color when a tone is given", () => {
    const { container } = render(<StatCard label="DEFECTS" value={3} tone="defect" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("border-l-4");
    expect(root.className).toContain("border-ih-bad");
    // flat full border is not applied in tone mode
    expect(root.className).not.toContain("border-ih-border ");
  });

  it("applies a different accent class per tone (reusing the Pill palette)", () => {
    const { container: satC } = render(<StatCard label="SAT" value={1} tone="sat" />);
    const sat = satC.firstChild as HTMLElement;
    cleanup();
    const { container: monC } = render(<StatCard label="MON" value={1} tone="monitor" />);
    const mon = monC.firstChild as HTMLElement;

    expect(sat.className).toContain("border-ih-ok");
    expect(mon.className).toContain("border-ih-watch");
    expect(sat.className).not.toBe(mon.className);
  });

  it("tints the label with the tone foreground color", () => {
    const { container } = render(<StatCard label="SAT" value={1} tone="sat" />);
    const label = screen.getByText("SAT");
    expect(label.className).toContain("text-ih-ok-fg");
    expect(container).toBeTruthy();
  });

  it("renders an optional hint sub-line", () => {
    render(<StatCard label="REVENUE" value="$1,000" hint="last 30 days" />);
    expect(screen.getByText("last 30 days")).toBeTruthy();
  });

  it("does not render a hint node when hint is omitted", () => {
    render(<StatCard label="TOTAL" value="7" />);
    expect(screen.queryByText("last 30 days")).toBeNull();
  });

  it("passes through an extra className", () => {
    const { container } = render(<StatCard label="X" value="1" className="col-span-2" />);
    expect((container.firstChild as HTMLElement).className).toContain("col-span-2");
  });
});
