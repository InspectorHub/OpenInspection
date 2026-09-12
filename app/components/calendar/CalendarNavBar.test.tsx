// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CalendarNavBar } from "./CalendarNavBar";
import { m } from "~/paraglide/messages";

/**
 * F32 — /calendar pushed its month/week/day buttons off a narrow screen.
 *
 * The page-header fix (packages/shared-ui/src/PageHeader.tsx) did not reach
 * this page, because these controls are NOT `PageHeader` actions: `/calendar`
 * renders `<PageHeader>` with a title and meta and no `actions`, and the
 * view-mode buttons live in this component's own top-level row instead.
 *
 * ⚠️ What this file can and cannot prove. happy-dom has no layout engine and
 * no Tailwind, so nothing here measures a width. These assertions name the
 * three CSS facts that DECIDE the overflow, exactly as `PageHeader.test.tsx`
 * does; the pixels are a browser matter and are not claimed here.
 *
 *   1. the row must be allowed to wrap — a `nowrap` row has nowhere to put the
 *      view buttons except off the right edge;
 *   2. the title column must be allowed to shrink below its min-content width,
 *      or a long month title (`text-xl` bold) keeps the space the buttons need;
 *   3. the view-mode block must be allowed to wrap INSIDE itself and to shrink,
 *      so it reflows rather than holding its full width against the row.
 */

function renderNavBar() {
  return render(
    <CalendarNavBar
      title="September 2026"
      viewMode="month"
      currentDate={new Date(2026, 8, 11)}
      locale="en-US"
      onPrev={vi.fn()}
      onNext={vi.fn()}
      onToday={vi.fn()}
      onJumpToMonth={vi.fn()}
      onViewModeChange={vi.fn()}
    />,
  );
}

function navBarParts() {
  const titleButton = screen.getByRole("button", { name: m.calendar_datepicker_open() });
  const titleColumn = titleButton.parentElement as HTMLElement;
  const row = titleColumn.parentElement as HTMLElement;
  const viewGroup = screen.getByRole("button", { name: m.calendar_view_month() })
    .parentElement as HTMLElement;
  return { row, titleColumn, viewGroup };
}

describe("CalendarNavBar layout", () => {
  it("lets the row wrap and the title column shrink", () => {
    renderNavBar();
    const { row, titleColumn } = navBarParts();

    expect(row.className).toContain("flex-wrap");
    expect(row.className).not.toContain("flex-nowrap");
    // Without this the title column's automatic minimum size is its longest
    // word, and the view buttons are pushed out by exactly that overflow.
    expect(titleColumn.className).toContain("min-w-0");
  });

  it("lets the view-mode block reflow instead of overflowing", () => {
    renderNavBar();
    const { viewGroup } = navBarParts();

    expect(viewGroup.className).toContain("flex-wrap");
    // `flex-shrink-0` is what would make this block unable to give anything
    // back: it would keep its full max-content width no matter how narrow the
    // row got.
    expect(viewGroup.className).not.toMatch(/(^|\s)(flex-)?shrink-0(\s|$)/);
  });

  it("keeps all three groups in the row it is asserting about", () => {
    renderNavBar();
    const { row, titleColumn, viewGroup } = navBarParts();

    // A guard on the selectors above: if the markup is restructured so that the
    // title and the view buttons stop being siblings, the two tests above would
    // start measuring class strings on unrelated elements.
    expect(viewGroup.parentElement).toBe(row);
    expect(screen.getByRole("button", { name: m.calendar_nav_today() }).parentElement?.parentElement)
      .toBe(row);
    expect(titleColumn.parentElement).toBe(row);
  });
});
