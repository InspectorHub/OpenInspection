/**
 * The two signature cards, and the rule they exist to keep.
 *
 * Settings → Profile used to carry ONE Save button, floating over six sections
 * and owning one of them. The other five saved on upload, on toggle, on sign,
 * on blur, on click — so the button taught the wrong rule in both directions.
 * Now the button owns the card it sits in, and every other card saves itself.
 *
 * That rule has a hard edge: a card with no button is claiming "this is already
 * saved". These specs pin that neither card grew a submit control, and that the
 * toggle is the thing that saves.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { EmailSignatureCard, SavedSignatureCard } from "./SignatureCards";

/**
 * Both cards submit through `useFetcher`, which needs a router. The stub is
 * used for RENDERING only — never for an auth assertion, which it cannot make
 * (it does not run middleware).
 */
function renderInRouter(ui: React.ReactElement, action = vi.fn(() => ({ success: true }))) {
  const Stub = createRoutesStub([{ path: "/", Component: () => ui, action }]);
  return { ...render(<Stub initialEntries={["/"]} />), action };
}

describe("EmailSignatureCard", () => {
  it("renders the toggle and the preview", () => {
    renderInRouter(
      <EmailSignatureCard enabled previewHtml="<div>— Dana Inspector</div>" />,
    );
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByText("— Dana Inspector")).toBeTruthy();
  });

  it("has NO submit control — the toggle is the save", () => {
    const { container } = renderInRouter(<EmailSignatureCard enabled previewHtml={null} />);
    // The whole point of the restructure. A button here would put the page back
    // to two competing save affordances for one card.
    expect(container.querySelectorAll("button[type=submit]")).toHaveLength(0);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("submits the toggle's new value, not its old one", async () => {
    const { action } = renderInRouter(<EmailSignatureCard enabled previewHtml={null} />);
    fireEvent.click(screen.getByRole("checkbox"));
    await vi.waitFor(() => expect(action).toHaveBeenCalled());
    const req: Request = action.mock.calls[0][0].request;
    const fd = await req.formData();
    expect(fd.get("intent")).toBe("signature-toggle");
    // Reading `.checked` AFTER the click, not inverting the prop — the two
    // differ the moment anything else touches the box.
    expect(fd.get("signatureEnabled")).toBe("false");
  });

  it("says WHY the signature is empty rather than showing a blank frame", () => {
    const { container } = renderInRouter(<EmailSignatureCard enabled previewHtml={null} />);
    // The copy points "above", which after the restructure is the profile card
    // holding exactly those fields — so the instruction still resolves.
    expect(screen.getByText(/Add your name .* above to build a signature/)).toBeTruthy();
    expect(container.querySelector(".bg-ih-bg-muted")).toBeNull();
  });
});

describe("SavedSignatureCard", () => {
  it("offers BOTH ways to sign, as siblings", () => {
    // Drawing and uploading are two routes to one mark, not a primary and a
    // fallback: an inspector with a scanned signature has no reason to redraw
    // it with a mouse, and one without a scanner cannot upload.
    renderInRouter(<SavedSignatureCard savedSignature={null} />);
    expect(screen.getByRole("button", { name: /draw signature/i })).toBeTruthy();
    expect(screen.getByText(/upload image/i)).toBeTruthy();
  });

  it("opens the picker through a LABEL, never a scripted click", () => {
    // `button` + `inputRef.click()` on a `display:none` input is the pattern
    // that silently does nothing when the browser declines it — and a control
    // that does not respond is indistinguishable from a broken one.
    const { container } = renderInRouter(<SavedSignatureCard savedSignature={null} />);
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    expect(input!.closest("label")).toBeTruthy();
    // sr-only, not hidden: still a rendered, focusable control.
    expect(input!.className).toContain("sr-only");
  });

  it("has no form submit — signing is what saves", () => {
    const { container } = renderInRouter(<SavedSignatureCard savedSignature={null} />);
    expect(container.querySelectorAll("button[type=submit]")).toHaveLength(0);
  });

  it("opens the signature pad on Draw", () => {
    renderInRouter(<SavedSignatureCard savedSignature={null} />);
    fireEvent.click(screen.getByRole("button", { name: /draw signature/i }));
    // The pad replaces the two actions: there is no state offering both the pad
    // and the controls that opened it.
    expect(screen.queryByRole("button", { name: /draw signature/i })).toBeNull();
  });
});

/**
 * A saved signature has to be VISIBLE.
 *
 * The card said "Signature saved." and showed nothing — so the one thing a
 * reader might want to check, that the mark captured is the one they meant, was
 * the one thing the page would not tell them. Short of sending themselves an
 * agreement there was no way to find out.
 */
describe("SavedSignatureCard — showing what was saved", () => {
  it("renders the saved signature", () => {
    renderInRouter(<SavedSignatureCard savedSignature="data:image/png;base64,AAAA" />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });

  it("shows the signing line even when empty, and no image", () => {
    // The empty state is the same ruled line, an invitation to sign — not a
    // grey box announcing an absence.
    const { container } = renderInRouter(<SavedSignatureCard savedSignature={null} />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.getByText(/Nothing signed yet/i)).toBeTruthy();
  });

  it("drops the empty hint once a signature exists", () => {
    renderInRouter(<SavedSignatureCard savedSignature="data:image/png;base64,AAAA" />);
    expect(screen.queryByText(/Nothing signed yet/i)).toBeNull();
  });

  it("hides the saved image while the pad is open, so the two never overlap", () => {
    renderInRouter(<SavedSignatureCard savedSignature="data:image/png;base64,AAAA" />);
    fireEvent.click(screen.getByRole("button", { name: /draw signature/i }));
    expect(screen.queryByRole("img")).toBeNull();
  });
});
