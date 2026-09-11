// @vitest-environment happy-dom
/**
 * F47 — THE RE-INSPECTION DIALOG HAS TO LET THE OPERATOR SAY WHICH DAY.
 *
 * The dialog used to offer an item selector, Cancel and Create, and nothing
 * else. Every re-inspection therefore landed on TODAY, and the operator's next
 * act was always to go and reschedule it — the round trip existed only because
 * the one screen that creates the appointment refused to ask about it.
 *
 * The finding is that you cannot CHOOSE, not that today is wrong. So the field
 * is prefilled with today and the one-click path is unchanged: open, Create.
 * What changes is that the day is now visible before the button is pressed, and
 * editable.
 *
 * It also moves WHERE the day comes from. A date the operator submitted is a
 * day a human chose, in the zone they are standing in; the server no longer has
 * to infer one from a company timezone that may never have been declared. That
 * inference is the live bug this field retires (see
 * tests/unit/inspections/reinspection-scheduled-day.spec.ts for the server half).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub, useFetcher } from "react-router";

import { CreateReinspectionModal } from "~/components/inspector-portal/CreateReinspectionModal";

/** Today as the BROWSER sees it — the same civil day the operator is living in,
 *  not `toISOString()`'s UTC day (which is tomorrow for a US-west evening). */
function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function renderModal(candidates = [{ itemId: "item-a", label: "Sink", originalNotes: "leak", open: true }]) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component() {
        const fetcher = useFetcher();
        return (
          <CreateReinspectionModal
            open
            candidates={candidates}
            fetcher={fetcher as never}
            submitting={false}
            error={undefined}
            onClose={() => {}}
          />
        );
      },
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

describe("CreateReinspectionModal scheduled-date field (F47)", () => {
  it("offers a date control, so the round is not silently filed on today", async () => {
    renderModal();
    const input = (await screen.findByLabelText(/date/i)) as HTMLInputElement;
    expect(input.type).toBe("date");
    // The name the action reads off the form and forwards to the API.
    expect(input.name).toBe("scheduledDate");
  });

  it("prefills the operator's own today, so Create is still one click", async () => {
    renderModal();
    const input = (await screen.findByLabelText(/date/i)) as HTMLInputElement;
    expect(input.value).toBe(localToday());
  });

  it("still shows the date when the baseline has no carry-forward candidates", async () => {
    // The empty-candidates branch renders a different body. A date control that
    // only exists on one of the two branches is a field that disappears exactly
    // when the operator is most likely to be scheduling something by hand.
    renderModal([]);
    const input = (await screen.findByLabelText(/date/i)) as HTMLInputElement;
    expect(input.name).toBe("scheduledDate");
  });
});
