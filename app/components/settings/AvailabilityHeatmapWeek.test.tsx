import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AvailabilityHeatmapWeek, type HeatmapDay } from "./AvailabilityHeatmapWeek";
import { m } from "~/paraglide/messages";

const DAYS: HeatmapDay[] = [
  { date: "2026-08-03", status: "open" },
  { date: "2026-08-04", status: "full" },
  { date: "2026-08-05", status: "closed", label: "Company Retreat" },
  { date: "2026-08-06", status: "open" },
  { date: "2026-08-07", status: "open" },
  { date: "2026-08-08", status: "unconfigured" },
  { date: "2026-08-09", status: "unconfigured" },
];

function cells(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="heatmap-cell"]')];
}

describe("AvailabilityHeatmapWeek", () => {
  it("renders one cell per supplied day", () => {
    const { container } = render(<AvailabilityHeatmapWeek days={DAYS} locale="en-US" />);
    expect(cells(container)).toHaveLength(7);
  });

  it("paints each status with its design-system token", () => {
    const { container } = render(<AvailabilityHeatmapWeek days={DAYS} locale="en-US" />);
    const painted = cells(container).map((c) => c.className);
    expect(painted[0]).toContain("bg-ih-ok");
    expect(painted[1]).toContain("bg-ih-watch");
    expect(painted[2]).toContain("bg-ih-bad");
    expect(painted[5]).toContain("bg-ih-bg-muted");
  });

  it("titles every cell with the translated status", () => {
    const { container } = render(<AvailabilityHeatmapWeek days={DAYS} locale="en-US" />);
    const titled = cells(container).map((c) => c.getAttribute("title"));
    expect(titled[0]).toContain(m.schedule_heatmap_open());
    expect(titled[1]).toContain(m.schedule_heatmap_full());
    expect(titled[2]).toContain(m.schedule_heatmap_closed());
    expect(titled[5]).toContain(m.schedule_heatmap_unconfigured());
  });

  it("carries the holiday name on a closed day", () => {
    const { container } = render(<AvailabilityHeatmapWeek days={DAYS} locale="en-US" />);
    expect(cells(container)[2].getAttribute("title")).toContain("Company Retreat");
  });

  it("labels cells with the civil day of month, not a zone-shifted one", () => {
    // A civil date carries no zone, so the strip must render 3..9 for this
    // week in every viewer timezone — anchoring it to the viewer's zone is
    // the calendar off-by-one bug.
    const { container } = render(<AvailabilityHeatmapWeek days={DAYS} locale="en-US" />);
    const numbers = cells(container).map((c) => c.querySelector('[data-testid="heatmap-day-number"]')?.textContent);
    expect(numbers).toEqual(["3", "4", "5", "6", "7", "8", "9"]);
  });

  it("renders weekday names in the supplied locale", () => {
    const { container: en } = render(<AvailabilityHeatmapWeek days={DAYS} locale="en-US" />);
    const { container: es } = render(<AvailabilityHeatmapWeek days={DAYS} locale="es-419" />);
    const weekdayOf = (c: HTMLElement) =>
      cells(c)[0].querySelector('[data-testid="heatmap-weekday"]')?.textContent;
    expect(weekdayOf(en)).toBeTruthy();
    expect(weekdayOf(es)).toBeTruthy();
    expect(weekdayOf(es)).not.toEqual(weekdayOf(en));
  });

  it("renders nothing when there are no days", () => {
    const { container } = render(<AvailabilityHeatmapWeek days={[]} locale="en-US" />);
    expect(cells(container)).toHaveLength(0);
  });
});
