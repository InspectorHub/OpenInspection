/**
 * OI #291 — `/library/comments` could create, edit and touch a canned comment
 * but never delete one, so 2,774 rows had no delete path at any surface. The
 * `DELETE /api/admin/comments/{id}` route already existed with zero callers.
 *
 * These tests pin the two things that make a destructive control safe: it never
 * fires without confirmation, and the confirmation says WHICH row (or how many)
 * — a library page is dozens of near-identical entries, and "delete this
 * comment?" cannot tell you whether the right one is selected.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import CommentsPage from "~/routes/comments";

const A = { id: "c1", text: "Cracked flue tile observed at the chimney crown.", severity: "significant" as const, section: "Chimney" };
const B = { id: "c2", text: "Downspout discharges against the foundation.", severity: "marginal" as const, section: "Exterior" };

function renderPage({ comments = [A, B], ok = true } = {}) {
  const calls: Record<string, string>[] = [];
  const Stub = createRoutesStub([
    {
      path: "/library/comments",
      Component: CommentsPage,
      action: async ({ request }) => {
        const form = await request.formData();
        calls.push(Object.fromEntries(form) as Record<string, string>);
        return { ok, intent: String(form.get("intent")), deleted: ok ? 1 : 0 };
      },
      loader: () => ({
        comments,
        meta: { total: comments.length, page: 1, pageSize: 50, totalPages: 1 },
        contractorTypes: [],
        loadFailed: false,
      }),
    },
  ]);
  render(<Stub initialEntries={["/library/comments"]} />);
  return { calls };
}

const rowDeleteButtons = () =>
  screen.getAllByRole("button", { name: /^delete$/i })
    .filter((b) => !b.closest('[role="dialog"]'));

async function confirm() {
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
}

describe("/library/comments — delete (#291)", () => {
  it("offers a delete control on every row", async () => {
    renderPage();
    await screen.findByText(A.text);
    expect(rowDeleteButtons()).toHaveLength(2);
  });

  it("does not delete without confirmation", async () => {
    const { calls } = renderPage();
    await screen.findByText(A.text);

    fireEvent.click(rowDeleteButtons()[0]);
    expect(calls).toHaveLength(0);

    // Backing out of the dialog is still not a delete.
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(calls).toHaveLength(0);
  });

  it("names the comment in the confirmation, not just 'this comment'", async () => {
    renderPage();
    await screen.findByText(A.text);
    fireEvent.click(rowDeleteButtons()[0]);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Cracked flue tile");
  });

  it("submits the delete intent for the row that was clicked", async () => {
    const { calls } = renderPage();
    await screen.findByText(A.text);
    fireEvent.click(rowDeleteButtons()[1]);
    await confirm();

    await waitFor(() => expect(calls).toEqual([{ intent: "delete", id: "c2" }]));
  });

  it("states how many will be deleted when several are selected", async () => {
    renderPage();
    await screen.findByText(A.text);

    fireEvent.click(screen.getByLabelText(/select all on this page/i));
    fireEvent.click(screen.getByRole("button", { name: /delete selected \(2\)/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("2");
  });

  it("names the single selected row instead of saying '1 comments'", async () => {
    renderPage();
    await screen.findByText(A.text);

    fireEvent.click(screen.getAllByLabelText(/select this comment/i)[0]);
    fireEvent.click(screen.getByRole("button", { name: /delete selected \(1\)/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Cracked flue tile");
    expect(dialog.textContent).not.toMatch(/1 comments/);
  });

  it("bulk delete sends exactly the selected ids", async () => {
    const { calls } = renderPage();
    await screen.findByText(A.text);

    fireEvent.click(screen.getAllByLabelText(/select this comment/i)[0]);
    fireEvent.click(screen.getByRole("button", { name: /delete selected \(1\)/i }));
    await confirm();

    await waitFor(() => expect(calls).toEqual([{ intent: "delete-many", ids: "c1" }]));
  });

  it("says nothing was removed when the delete fails", async () => {
    renderPage({ comments: [A], ok: false });
    await screen.findByText(A.text);

    fireEvent.click(rowDeleteButtons()[0]);
    await confirm();

    expect(await screen.findByRole("alert")).toHaveTextContent(/nothing was removed/i);
  });
});
