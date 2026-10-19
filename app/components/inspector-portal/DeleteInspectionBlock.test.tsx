// @vitest-environment happy-dom
/**
 * Deleting an inspection from its own page.
 *
 * The control is offered only to someone who holds the deleteInspection
 * capability (the same rule as the list). It opens a confirmation that names
 * what is erased and cannot be confirmed until the person ticks that they
 * understand. When the record is weighty (a published report, a payment, a
 * signed agreement) it says so and offers to cancel instead. A failed delete
 * leaves the dialog open with the reason; a successful one (or one that finds
 * the inspection already gone) goes back to the list.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";

const purge = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("~/lib/collab/offline-purge", () => ({ purgeInspectionOfflineData: purge }));
vi.mock("~/components/inspector-portal/CancelInspectionModal", () => ({
  CancelInspectionModal: ({ inspectionId }: { inspectionId: string }) => <div role="dialog" aria-label="cancel flow">CANCEL FLOW {inspectionId}</div>,
}));

import { DeleteInspectionBlock, type DeleteFacts } from "~/components/inspector-portal/DeleteInspectionBlock";

const PLAIN: DeleteFacts = { reportPublished: false, invoicePresent: false, paymentReceived: false, agreementPresent: false, agreementSigned: false };
const posted: Array<Record<string, FormDataEntryValue>> = [];
let reply: () => { ok: boolean; intent: "delete"; error?: string } = () => ({ ok: true, intent: "delete" });

function mount(opts: { canDelete?: boolean; facts?: Partial<DeleteFacts>; canCancelInstead?: boolean } = {}) {
  const context = { branding: { defaultLocale: "en-US", defaultTimezone: "UTC" }, user: { capabilities: { deleteInspection: opts.canDelete ?? true } } };
  const Stub = createRoutesStub([
    {
      id: "routes/auth-layout",
      path: "/",
      loader: () => ({ context }),
      Component: () => <Outlet />,
      children: [
        { path: "inspections", Component: () => <p>THE LIST</p> },
        {
          path: "inspections/:id",
          Component: () => <DeleteInspectionBlock inspectionId="insp-1" facts={{ ...PLAIN, ...opts.facts }} canCancelInstead={opts.canCancelInstead ?? true} />,
          action: async ({ request }) => {
            posted.push(Object.fromEntries(await request.formData()));
            return reply();
          },
        },
      ],
    },
  ]);
  return render(<Stub initialEntries={["/inspections/insp-1"]} />);
}

const openDialog = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /Delete this inspection/ }));
  return await screen.findByRole("dialog");
};
const confirmButton = () => screen.getByRole("button", { name: "Delete inspection" });
const tick = () => fireEvent.click(screen.getByRole("checkbox", { name: /I understand this permanently deletes this inspection and its files/ }));

beforeEach(() => {
  posted.length = 0;
  purge.mockClear();
  reply = () => ({ ok: true, intent: "delete" });
});

describe("DeleteInspectionBlock", () => {
  it("is not offered without the deleteInspection capability", async () => {
    mount({ canDelete: false });
    await new Promise((r) => setTimeout(r, 40));
    expect(screen.queryByRole("button", { name: /Delete this inspection/ })).toBeNull();
    expect(screen.queryByText("Delete inspection")).toBeNull();
  });

  it("POSITIVE CONTROL: offered with the capability", async () => {
    mount({ canDelete: true });
    expect(await screen.findByRole("button", { name: /Delete this inspection/ })).toBeTruthy();
  });

  it("the dialog is labelled and lists what is erased and that it cannot be undone", async () => {
    mount();
    const dialog = await openDialog();
    const text = dialog.textContent ?? "";
    expect(dialog.getAttribute("aria-labelledby") || dialog.getAttribute("aria-label")).toBeTruthy();
    expect(text).toMatch(/cannot be undone/i);
    for (const item of [/results/i, /photos and other files/i, /report version/i, /invoice/i, /agreements and their signer/i, /messages/i, /links stop working/i]) {
      expect(text).toMatch(item);
    }
  });

  it("does not claim a retention rule, and mentions signing audit entries only when there is an agreement", async () => {
    const first = mount();
    const plain = await openDialog();
    expect(plain.textContent ?? "").not.toMatch(/audit/i);
    expect(plain.textContent ?? "").not.toMatch(/retain|retention|kept for/i);
    first.unmount();
    mount({ facts: { agreementPresent: true } });
    const withAgreement = await openDialog();
    expect(withAgreement.textContent ?? "").toMatch(/Signing audit entries are not deleted by this action/);
  });

  it("the Delete button does nothing until the person ticks that they understand", async () => {
    mount();
    await openDialog();
    expect(screen.getByRole("checkbox", { name: /I understand/ }).getAttribute("type")).toBe("checkbox");
    fireEvent.click(confirmButton());
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(posted).toEqual([]);
    tick();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ intent: "delete" });
  });

  it.each([
    ["a published report", { reportPublished: true }, /report has been published/i],
    ["an invoice that exists", { invoicePresent: true }, /invoice exists/i],
    ["a payment received", { invoicePresent: true, paymentReceived: true }, /payment has been received/i],
    ["a signed agreement", { agreementPresent: true, agreementSigned: true }, /agreement has been signed/i],
  ] as Array<[string, Partial<DeleteFacts>, RegExp]>)("states the facts and the extra warning for %s", async (_n, facts, fact) => {
    mount({ facts });
    const dialog = await openDialog();
    expect(dialog.textContent ?? "").toMatch(fact);
    if (facts.reportPublished || facts.paymentReceived || facts.agreementSigned) {
      expect(dialog.textContent ?? "").toMatch(/Deleting removes that record for good/);
      expect(within(dialog).getByRole("button", { name: "Cancel the inspection instead" })).toBeTruthy();
    }
  });

  it("an inspection with nothing weighty shows no extra warning and no cancel link", async () => {
    mount({ facts: { invoicePresent: true } });
    const dialog = await openDialog();
    expect(dialog.textContent ?? "").not.toMatch(/Deleting removes that record for good/);
    expect(within(dialog).queryByRole("button", { name: "Cancel the inspection instead" })).toBeNull();
  });

  it("the cancel link opens the existing cancel flow and leaves the delete dialog", async () => {
    mount({ facts: { reportPublished: true } });
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel the inspection instead" }));
    expect(await screen.findByText(/CANCEL FLOW insp-1/)).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /I understand/ })).toBeNull();
  });

  it("without the right to cancel the warning stays but the cancel link does not", async () => {
    mount({ facts: { reportPublished: true }, canCancelInstead: false });
    const dialog = await openDialog();
    expect(dialog.textContent ?? "").toMatch(/Deleting removes that record for good/);
    expect(within(dialog).queryByRole("button", { name: "Cancel the inspection instead" })).toBeNull();
  });

  it("a double click sends exactly one delete", async () => {
    mount();
    await openDialog();
    tick();
    const button = confirmButton();
    await act(async () => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(posted).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 60));
    expect(posted).toHaveLength(1);
  });

  it("on success it clears the device's cached copy of that inspection and goes back to the list", async () => {
    mount();
    await openDialog();
    tick();
    fireEvent.click(confirmButton());
    expect(await screen.findByText("THE LIST")).toBeTruthy();
    await waitFor(() => expect(purge).toHaveBeenCalledWith("insp-1"));
  });

  it("an inspection that is already gone is the same success (the action reports ok)", async () => {
    reply = () => ({ ok: true, intent: "delete" });
    mount();
    await openDialog();
    tick();
    fireEvent.click(confirmButton());
    expect(await screen.findByText("THE LIST")).toBeTruthy();
  });

  it("a failed delete keeps the dialog open with the reason in an alert, does not purge, and can be retried", async () => {
    reply = () => ({ ok: false, intent: "delete", error: "You cannot delete inspections" });
    mount();
    await openDialog();
    tick();
    fireEvent.click(confirmButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/You cannot delete inspections/);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByText("THE LIST")).toBeNull();
    expect(purge).not.toHaveBeenCalled();
    reply = () => ({ ok: true, intent: "delete" });
    fireEvent.click(confirmButton());
    expect(await screen.findByText("THE LIST")).toBeTruthy();
  });

  it("closing and reopening the dialog starts unticked", async () => {
    mount();
    await openDialog();
    tick();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await openDialog();
    expect((screen.getByRole("checkbox", { name: /I understand/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("a failure shown before closing is not shown again when the dialog is reopened", async () => {
    reply = () => ({ ok: false, intent: "delete", error: "You cannot delete inspections" });
    mount();
    await openDialog();
    tick();
    fireEvent.click(confirmButton());
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await openDialog();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
