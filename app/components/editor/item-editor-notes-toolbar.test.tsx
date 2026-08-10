// @vitest-environment happy-dom
/**
 * Where the "Recommended comments" control lives (#73).
 *
 * This spec exists because the defect it pins is invisible to every other
 * check in the repo. The control used to be `absolute right-2 top-2` INSIDE
 * the textarea's positioned wrapper, floating over the field. A textarea
 * cannot indent only its first line, so the moment line one reached the right
 * edge the control sat on top of the inspector's own words — and nothing in
 * type-check, eslint or `lint:ds` can see one box covering another. Only a
 * browser could, and only if someone happened to type a long enough first
 * line. The AI "Improve wording" action made that every note rather than an
 * occasional one.
 *
 * So the assertions below are STRUCTURAL, not cosmetic. They fail if anyone
 * puts the control back over the field:
 *   - it is not inside the textarea's positioned wrapper,
 *   - it comes BEFORE the textarea in the document, and
 *   - it carries no absolute positioning of its own.
 *
 * A wiring test guards the other half: moving a control is only a fix if the
 * control still does its job, so picking a suggestion must still write the
 * canned text back through `onNotes`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ItemEditor } from "./ItemEditor";

/** `Node.DOCUMENT_POSITION_FOLLOWING`, spelled out so the assertion does not
 *  depend on the DOM implementation exposing the constant. */
const FOLLOWING = 4;

const CANNED = {
  id: "d1",
  title: "Granule loss",
  comment: "Granule loss was observed at the eave. Monitor and budget for replacement.",
};

const base = {
  sectionTitle: "Roof",
  onRating: vi.fn(),
  onNotesBlur: vi.fn(),
};

function renderItem(opts: { withCanned?: boolean; onNotes?: (v: string) => void } = {}) {
  const onNotes = opts.onNotes ?? vi.fn();
  render(
    <ItemEditor
      {...base}
      onNotes={onNotes}
      item={{
        id: "i1",
        label: "Roof Covering",
        type: "rich",
        ...(opts.withCanned === false ? {} : { tabs: { defects: [CANNED] } }),
      }}
      result={{}}
    />
  );
  return { onNotes };
}

const trigger = () => screen.getByTestId("notes-recommended-trigger");
const notes = () => screen.getByLabelText("Notes") as HTMLTextAreaElement;

describe("ItemEditor — the Recommended-comments control is out of the Notes box", () => {
  it("renders the control OUTSIDE the textarea's positioned wrapper", () => {
    renderItem();
    // The old bug in one line: the button was a child of the same `relative`
    // element as the textarea, which is what let it be painted over the text.
    expect(notes().parentElement?.contains(trigger())).toBe(false);
  });

  it("places the control BEFORE the textarea, as a toolbar above the field", () => {
    renderItem();
    expect(trigger().compareDocumentPosition(notes()) & FOLLOWING).toBeTruthy();
  });

  it("does not position the control absolutely", () => {
    renderItem();
    expect(trigger().className).not.toMatch(/\babsolute\b/);
  });

  it("shares the header row with the Notes label and the character meter", () => {
    renderItem();
    const row = trigger().parentElement!;
    expect(row.textContent).toContain("Notes");
    expect(row.textContent).toMatch(/0 chars/);
  });

  it("labels the textarea, so the header reads as this field's own toolbar", () => {
    renderItem();
    // getByLabelText resolving at all is the assertion: the <label> is wired
    // to the textarea by htmlFor, not merely sitting near it.
    expect(notes().tagName).toBe("TEXTAREA");
  });

  it("offers nothing when the item has no canned comments to insert", () => {
    // CONTROL is every case above, where the item DOES have a canned entry and
    // the trigger is found — so this is about the empty library, not about the
    // query being wrong.
    renderItem({ withCanned: false });
    expect(screen.queryByTestId("notes-recommended-trigger")).toBeNull();
  });
});

describe("ItemEditor — the moved control still inserts the comment", () => {
  it("opens the suggestion list, focuses the note, and reports it is expanded", () => {
    renderItem();
    expect(trigger().getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger());

    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getByText(CANNED.title)).toBeTruthy();
    expect(document.activeElement).toBe(notes());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("writes the canned text into the note when a suggestion is picked", () => {
    const onNotes = vi.fn();
    renderItem({ onNotes });

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: /Granule loss/ }));

    expect(onNotes).toHaveBeenCalledWith(CANNED.comment);
  });
});
