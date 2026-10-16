// @vitest-environment happy-dom
/**
 * A viewer who cannot create inspections (staff) is not given a New Inspection
 * button by the empty list, any more than by the page header.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { InspectionsEmptyState } from "~/components/dashboard/InspectionsEmptyState";
import type { ListFilterState } from "~/lib/dashboard-filters";

const NO_FILTERS = {
  tab: "all", focus: "", timeFilter: "all", tagId: "", dateFrom: "", dateTo: "", agentId: "", search: "",
} as unknown as ListFilterState;

describe("InspectionsEmptyState - create button", () => {
  it("offers New Inspection when the viewer can create", () => {
    const { getByRole } = render(
      <InspectionsEmptyState totalAll={0} filters={NO_FILTERS} onClearFilters={() => {}} onCreate={() => {}} />,
    );
    expect(getByRole("button", { name: /new inspection/i })).toBeTruthy();
  });

  it("offers no button when the viewer cannot create", () => {
    const { queryByRole } = render(
      <InspectionsEmptyState totalAll={0} filters={NO_FILTERS} onClearFilters={() => {}} />,
    );
    expect(queryByRole("button")).toBeNull();
  });
});
