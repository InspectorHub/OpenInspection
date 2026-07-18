import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { render, fireEvent } from "@testing-library/react";
import { CalendarDatePicker } from "./CalendarDatePicker";

function setup(onSelect = vi.fn(), value = new Date(2026, 6, 15)) {
  const anchorRef = createRef<HTMLButtonElement>();
  const utils = render(
    <>
      <button ref={anchorRef}>anchor</button>
      <CalendarDatePicker
        open
        onClose={vi.fn()}
        anchorRef={anchorRef}
        value={value}
        onSelect={onSelect}
        locale="en-US"
      />
    </>,
  );
  return { ...utils, onSelect };
}

describe("CalendarDatePicker", () => {
  it("opens on the month grid seeded to the active month", () => {
    const { getByTestId } = setup();
    expect(getByTestId("calendar-date-picker")).toBeTruthy();
    // July (index 6) is selected for the seed date.
    expect(getByTestId("dp-month-6").getAttribute("aria-pressed")).toBe("true");
    expect(getByTestId("dp-month-0").getAttribute("aria-pressed")).toBe("false");
  });

  it("jumps to the picked month of the viewed year", () => {
    const { getByTestId, onSelect } = setup();
    fireEvent.click(getByTestId("dp-month-11")); // December
    expect(onSelect).toHaveBeenCalledTimes(1);
    const arg = onSelect.mock.calls[0][0] as Date;
    expect(arg.getFullYear()).toBe(2026);
    expect(arg.getMonth()).toBe(11);
    expect(arg.getDate()).toBe(1);
  });

  it("steps the year with the caption arrows", () => {
    const { getByLabelText, getByTestId, onSelect } = setup();
    fireEvent.click(getByLabelText("Next year"));
    fireEvent.click(getByTestId("dp-month-0")); // January of 2027
    const arg = onSelect.mock.calls[0][0] as Date;
    expect(arg.getFullYear()).toBe(2027);
    expect(arg.getMonth()).toBe(0);
  });

  it("drills into the year grid and back to months", () => {
    const { getByLabelText, getByTestId, queryByTestId } = setup();
    // Click the year caption to open the decade grid.
    fireEvent.click(getByLabelText("Choose year"));
    expect(getByTestId("dp-year-2026")).toBeTruthy();
    expect(queryByTestId("dp-month-0")).toBeNull();
    // The seeded year is highlighted.
    expect(getByTestId("dp-year-2026").getAttribute("aria-pressed")).toBe("true");
    // Pick a far year → back to months, now viewing that year.
    fireEvent.click(getByTestId("dp-year-2031"));
    expect(getByTestId("dp-month-0")).toBeTruthy();
  });

  it("selects a month in the year jumped to", () => {
    const { getByLabelText, getByTestId, onSelect } = setup();
    fireEvent.click(getByLabelText("Choose year"));
    fireEvent.click(getByTestId("dp-year-2029"));
    fireEvent.click(getByTestId("dp-month-2")); // March 2029
    const arg = onSelect.mock.calls[0][0] as Date;
    expect(arg.getFullYear()).toBe(2029);
    expect(arg.getMonth()).toBe(2);
  });

  it("pages the year window without overlap", () => {
    const { getByLabelText, getByTestId, queryByTestId } = setup();
    fireEvent.click(getByLabelText("Choose year")); // window 2020–2031
    expect(getByTestId("dp-year-2020")).toBeTruthy();
    expect(getByTestId("dp-year-2031")).toBeTruthy();
    fireEvent.click(getByLabelText("Next years"));
    expect(queryByTestId("dp-year-2031")).toBeNull();
    expect(getByTestId("dp-year-2032")).toBeTruthy();
    expect(getByTestId("dp-year-2043")).toBeTruthy();
  });
});
