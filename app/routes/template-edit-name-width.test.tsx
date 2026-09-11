// @vitest-environment happy-dom
/**
 * F38 — the template editor's name field clipped the name it was editing.
 *
 * Measured on the real page: `clientWidth` 192, `scrollWidth` 223, so 31px of
 * "Standard Residential Inspection" was cut off with `text-overflow: clip` —
 * no ellipsis, nothing to say anything was missing — while the toolbar had
 * ~600px of empty space to the right of the field.
 *
 * This renders the real route and asks the question the fixed width could not
 * answer: does the field ask for room for the name it is holding? happy-dom
 * cannot measure pixels, but `size` is a character count, which is the unit the
 * defect was actually in.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import TemplateEdit from "~/routes/template-edit";

const LONG_NAME = "Standard Residential Inspection"; // 31 chars — the one that clipped

// Stubbed ONCE for the file, not per test, and never unstubbed. The editor's
// comment-library fetcher is in flight when a test ends, so a per-test stub that
// is removed in `afterEach` lets that request land on the real `fetch` — which
// tests/setup-web.ts correctly fails the run for, and attributes to whichever
// test happened to be running. Verified: per-test stubbing passed alone and
// failed in a batch.
vi.stubGlobal(
  "fetch",
  vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } })),
);

function renderEditor(name: string) {
  const Stub = createRoutesStub([
    {
      path: "/templates/:id/edit",
      Component: TemplateEdit,
      loader: () => ({
        id: "t1",
        name,
        version: 3,
        schema: { sections: [{ id: "s1", title: "Roof", items: [] }] },
        token: "tok",
        defectCategories: [],
        defaultProfileId: null,
        statutoryFormId: null,
      }),
    },
    { path: "/resources/comments-library", loader: () => ({ comments: [] }) },
  ]);
  render(<Stub initialEntries={["/templates/t1/edit"]} />);
}

describe("template editor — the name field", () => {
  it("asks for room for the whole name", async () => {
    renderEditor(LONG_NAME);
    const input = (await screen.findByDisplayValue(LONG_NAME)) as HTMLInputElement;

    const size = Number(input.getAttribute("size"));
    expect(Number.isFinite(size)).toBe(true);
    expect(size).toBeGreaterThanOrEqual(LONG_NAME.length);
  });

  it("pins no fixed width that a longer name could outgrow", async () => {
    renderEditor(LONG_NAME);
    const input = (await screen.findByDisplayValue(LONG_NAME)) as HTMLInputElement;

    // `w-48` was the defect: one width, correct for one string length.
    expect(input.className).not.toMatch(/(^|\s)w-\d/);
    // …and it has to be able to give that width back when the row is short of
    // room, or the fix trades a clipped name for an overflowing toolbar.
    expect(input.className).toContain("min-w-0");
  });

  it("keeps a short name on a clickable target", async () => {
    renderEditor("Shed");
    const input = (await screen.findByDisplayValue("Shed")) as HTMLInputElement;
    expect(Number(input.getAttribute("size"))).toBeGreaterThan("Shed".length);
  });
});
