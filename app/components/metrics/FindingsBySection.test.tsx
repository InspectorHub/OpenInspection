/**
 * What a tenant running more than one rating system sees.
 *
 * The rule this pins: systems are never merged, one is shown at a time, and the
 * findings behind the other systems are COUNTED IN THE UI rather than silently
 * dropped. A filtered view that does not say what it filtered is how a reader
 * concludes their data has gone missing.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { FindingsBySection, type FindingsData } from "./FindingsBySection";

const DEFAULT_SYSTEM = {
  systemId: "rs-default",
  systemName: "OpenInspection Default",
  columns: [
    { key: "satisfactory", label: "Satisfactory", color: "#10b981" },
    { key: "defect", label: "Defect", color: "#ef4444" },
  ],
  rows: [{ section: "Roof", counts: { satisfactory: 4, defect: 2 }, total: 6 }],
  total: 6,
};

const TREC_SYSTEM = {
  systemId: "rs-trec",
  systemName: "TREC (Texas REC)",
  columns: [
    { key: "inspected", label: "Inspected", color: "#10b981" },
    { key: "deficient", label: "Deficient", color: "#ef4444" },
  ],
  rows: [{ section: "Foundation", counts: { inspected: 3, deficient: 1 }, total: 4 }],
  total: 4,
};

const MULTI: FindingsData = { systems: [DEFAULT_SYSTEM, TREC_SYSTEM], total: 10 };
const SINGLE: FindingsData = { systems: [DEFAULT_SYSTEM], total: 6 };

describe("FindingsBySection with one rating system", () => {
  it("shows no selector — there is nothing to choose between", () => {
    const { container, queryByText } = render(<FindingsBySection findings={SINGLE} />);
    expect(container.querySelector("select")).toBeNull();
    expect(queryByText(/more findings were rated under a different rating system/i)).toBeNull();
  });
});

describe("FindingsBySection with several rating systems", () => {
  it("defaults to the busiest system and never merges the vocabularies", () => {
    const { getByText, queryByText } = render(<FindingsBySection findings={MULTI} />);
    // The server orders systems by volume, so [0] is the default view.
    expect(getByText("Satisfactory")).toBeTruthy();
    expect(getByText("Roof")).toBeTruthy();
    // TREC's columns and rows must NOT appear alongside the default system's.
    expect(queryByText("Deficient")).toBeNull();
    expect(queryByText("Foundation")).toBeNull();
  });

  it("states how many findings the current view is not showing", () => {
    const { getByText } = render(<FindingsBySection findings={MULTI} />);
    // 10 total − 6 in the active system = 4 behind the other system.
    expect(getByText(/^4 more findings were rated under a different rating system/)).toBeTruthy();
  });

  it("switches the whole matrix when another system is chosen", () => {
    const { container, getByText, queryByText } = render(<FindingsBySection findings={MULTI} />);
    const select = container.querySelector("select")!;
    fireEvent.change(select, { target: { value: "rs-trec" } });

    expect(getByText("Deficient")).toBeTruthy();
    expect(getByText("Foundation")).toBeTruthy();
    // The previous system's column set is fully gone, not appended.
    expect(queryByText("Satisfactory")).toBeNull();
    expect(queryByText("Roof")).toBeNull();
    // …and the hidden count follows the selection: 10 − 4 = 6.
    expect(getByText(/^6 more findings were rated under a different rating system/)).toBeTruthy();
  });

  it("labels each option with its own finding count", () => {
    const { container } = render(<FindingsBySection findings={MULTI} />);
    const options = Array.from(container.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["OpenInspection Default · 6", "TREC (Texas REC) · 4"]);
  });

  it("falls back to the busiest system when the selected one leaves the window", () => {
    // The date-range picker refetches; a system with findings last range may
    // have none in this one, and a pinned id would render an empty card.
    const { container, rerender, getByText } = render(<FindingsBySection findings={MULTI} />);
    fireEvent.change(container.querySelector("select")!, { target: { value: "rs-trec" } });
    expect(getByText("Foundation")).toBeTruthy();

    rerender(<FindingsBySection findings={SINGLE} />);
    expect(getByText("Roof")).toBeTruthy();
  });
});

describe("FindingsBySection with nothing to show", () => {
  it("renders the empty state rather than an empty table", () => {
    const { getByText, container } = render(<FindingsBySection findings={{ systems: [], total: 0 }} />);
    expect(getByText(/No rated findings in this date range/i)).toBeTruthy();
    expect(container.querySelector("table")).toBeNull();
  });

  it("renders the empty state when the findings fetch failed outright", () => {
    const { getByText } = render(<FindingsBySection findings={null} />);
    expect(getByText(/No rated findings in this date range/i)).toBeTruthy();
  });
});
