// @vitest-environment happy-dom
/**
 * IA-65 — the inspection's signing requests, rendered on the inspection.
 *
 * Two things this file is here to hold still:
 *
 *  1. Signer management (remind / copy-link) is owner/manager-only on the
 *     server. The hub is a page inspectors live on, so the affordance has to be
 *     gated by the same capability — otherwise moving the feature here converts
 *     a page an inspector never saw into a button that 403s in their face.
 *  2. The evidence downloads and the pre-sign are NOT admin-only (their routes
 *     admit inspectors), and they were the whole reason the Library page still
 *     had to be visited. Gating them by mistake would move the errand rather
 *     than remove it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { SigningRequests, type HubAgreementRequest } from "./SigningRequests";

afterEach(cleanup);

const base: HubAgreementRequest = {
  id: "req-1",
  status: "sent",
  clientEmail: "jane@example.com",
  signedAt: null,
  createdAt: "2026-07-20T10:00:00.000Z",
  agreementName: "Standard Agreement",
  signersTotal: 2,
  signersSigned: 1,
};

/**
 * Rendered inside a data router: expanding a row mounts RequestDetail, which
 * loads its signers through a fetcher. The stub only has to provide the router
 * context — the signer payload itself is the resource route's subject, not
 * this file's.
 */
function renderList(requests: HubAgreementRequest[], canManageSigners = true) {
  const onSend = vi.fn();
  const onPreSign = vi.fn();
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <SigningRequests
          requests={requests}
          canManageSigners={canManageSigners}
          displayTz="UTC"
          onSend={onSend}
          onPreSign={onPreSign}
        />
      ),
    },
    { path: "/resources/agreement-signers", action: () => ({ ok: true, intent: "load-signers", signers: [] }) },
  ]);
  render(<Stub initialEntries={["/"]} />);
  return { onSend, onPreSign };
}

describe("SigningRequests — what the inspection shows", () => {
  it("names the template and its signing progress, not just an email", () => {
    renderList([base]);
    expect(screen.getByText("Standard Agreement")).toBeTruthy();
    // "1/2 signed" is the answer to "can I publish yet" — the old hub card
    // showed a status word and a recipient address, and nothing about who was
    // still outstanding.
    expect(screen.getByText(/1\s*\/\s*2/)).toBeTruthy();
    expect(screen.getByText(/jane@example.com/)).toBeTruthy();
  });

  it("offers the evidence downloads once signed, and not before", () => {
    renderList([{ ...base, status: "signed", signersSigned: 2, signedAt: "2026-07-21T10:00:00.000Z" }]);
    const pdf = screen.getByRole("link", { name: /signed pdf/i }) as HTMLAnchorElement;
    expect(pdf.href).toContain("/api/admin/agreement-requests/req-1/pdf");
    expect(screen.getByRole("link", { name: /certificate/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /evidence/i })).toBeTruthy();

    cleanup();
    renderList([base]);
    expect(screen.queryByRole("link", { name: /signed pdf/i })).toBeNull();
  });

  it("keeps the evidence downloads for a non-admin — their API allows them", () => {
    renderList([{ ...base, status: "signed", signersSigned: 2 }], false);
    expect(screen.getByRole("link", { name: /signed pdf/i })).toBeTruthy();
  });

  it("offers the pre-sign on a pending envelope, to admins and inspectors alike", () => {
    const { onPreSign } = renderList([{ ...base, status: "pending" }], false);
    fireEvent.click(screen.getByRole("button", { name: /sign now/i }));
    expect(onPreSign).toHaveBeenCalledWith("req-1");
  });

  it("hides signer management from a non-admin (the API refuses it)", () => {
    renderList([base], false);
    expect(screen.queryByRole("button", { name: /signers/i })).toBeNull();
  });

  it("expands signer management for an admin", () => {
    renderList([base], true);
    const toggle = screen.getByRole("button", { name: /signers/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /hide/i }).getAttribute("aria-expanded")).toBe("true");
  });

  it("still offers Send when the inspection has no agreement out yet", () => {
    const { onSend } = renderList([]);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onSend).toHaveBeenCalled();
  });
});
