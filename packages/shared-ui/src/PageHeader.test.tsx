// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader";

/**
 * F32 — the page header pushed its primary action outside a narrow viewport.
 *
 * ⚠️ What this file can and cannot prove. happy-dom has no layout engine and
 * no Tailwind: nothing here can measure a width, so these assertions name the
 * three CSS facts that DECIDED the overflow rather than the pixels that
 * resulted from it. Measured geometry (390px: `/inspections` document 416px,
 * `/team` 481px, `/calendar` 523px) comes from the browser pass.
 *
 * The three facts, and why each is a separate assertion:
 *   1. the row must be allowed to wrap — a `nowrap` row has nowhere to put
 *      actions that do not fit except off the right edge;
 *   2. the title column must be allowed to shrink below its min-content width,
 *      or a long title keeps the space the actions needed;
 *   3. the actions block must be allowed to wrap INSIDE itself and to shrink —
 *      a group of controls wider than the viewport (Contacts: ~520px) is not
 *      rescued by being moved to a second line of the same width.
 */

function headerParts() {
  const title = screen.getByRole("heading", { level: 1 });
  const titleColumn = title.parentElement as HTMLElement;
  const row = titleColumn.parentElement as HTMLElement;
  return { row, titleColumn };
}

test("the header row wraps and the title column can shrink", () => {
  render(<PageHeader title="A property inspection with a long name" actions={<button>New Inspection</button>} />);
  const { row, titleColumn } = headerParts();

  expect(row.className).toContain("flex-wrap");
  expect(row.className).not.toContain("flex-nowrap");
  // Without this the title column's automatic minimum size is its longest
  // word, and the actions are pushed out by exactly that overflow.
  expect(titleColumn.className).toContain("min-w-0");
});

test("the actions block can reflow instead of overflowing", () => {
  render(
    <PageHeader
      title="Contacts"
      actions={
        <>
          <select aria-label="status" />
          <select aria-label="type" />
          <a href="/settings/imports">Import contacts</a>
          <button>Add contact</button>
        </>
      }
    />,
  );
  const actions = screen.getByRole("button", { name: "Add contact" }).parentElement as HTMLElement;

  expect(actions.className).toContain("flex-wrap");
  // `flex-shrink-0` is what made this block unable to give anything back: it
  // kept its full max-content width no matter how narrow the row got.
  expect(actions.className).not.toMatch(/(^|\s)(flex-)?shrink-0(\s|$)/);
});

test("a header with no actions still renders the title column", () => {
  render(<PageHeader title="Metrics" />);
  const { row, titleColumn } = headerParts();
  expect(row.className).toContain("flex-wrap");
  expect(titleColumn.className).toContain("min-w-0");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Metrics");
});
