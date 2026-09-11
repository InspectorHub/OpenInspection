// @vitest-environment happy-dom
/**
 * IA-88 ⑥ — a native date field renders its placeholder and its part order in
 * the BROWSER's language, not the page's. Measured on an English page: the
 * field drew a Japanese date order instead of an English one.
 *
 * The attribute the control actually reads is `lang` on the input itself —
 * inheriting it from `<html lang>` is not enough, which is why the hub's own
 * date and datetime fields carry it explicitly (`ScheduleCard`,
 * `AddVisitModal`, `OrderDetailsCard`). These two filters did not, so the
 * dashboard's date range was the one place in that flow that changed shape
 * with the browser.
 *
 * Both directions, because the attribute is only right on the controls that
 * have a native localized rendering: the two date fields carry it, and the
 * plain text field beside them does not.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { FiltersDrawer } from "./FiltersDrawer";

const NOOP = () => {};

function openDrawer() {
  return render(
    <FiltersDrawer
      open
      onClose={NOOP}
      filterDateFrom=""
      filterDateTo=""
      filterAgentId=""
      setFilterDateFrom={NOOP}
      setFilterDateTo={NOOP}
      setFilterAgentId={NOOP}
    />,
  );
}

/**
 * Queried with `querySelectorAll`, not `findAllByDisplayValue(…, { selector })`:
 * that option is not applied as a filter here and hands back the drawer's text
 * input as well, which would have made the count assertion below meaningless.
 */
async function dateInputs(container: HTMLElement): Promise<HTMLInputElement[]> {
  let found: HTMLInputElement[] = [];
  await vi.waitFor(() => {
    found = [...container.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    expect(found.length).toBeGreaterThan(0);
  });
  return found;
}

describe("FiltersDrawer date fields", () => {
  it("pins every native date picker to the page's language", async () => {
    const { container } = openDrawer();
    const dates = await dateInputs(container);

    expect(dates).toHaveLength(2);
    for (const input of dates) {
      expect(input).toHaveAttribute("lang", "en");
    }
  });

  it("leaves the plain text filter alone", async () => {
    const { container } = openDrawer();
    await dateInputs(container);

    const text = container.querySelector('input[type="text"]');
    expect(text).not.toBeNull();
    expect(text).not.toHaveAttribute("lang");
  });
});
