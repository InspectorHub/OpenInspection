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
  it("offers to add a signature, and nothing that looks like a form submit", () => {
    const { container } = renderInRouter(<SavedSignatureCard />);
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    // `type="button"` — it opens the pad. Signing is what saves.
    expect(buttons[0].getAttribute("type")).toBe("button");
    expect(container.querySelectorAll("button[type=submit]")).toHaveLength(0);
  });

  it("opens the signature pad on click", () => {
    renderInRouter(<SavedSignatureCard />);
    fireEvent.click(screen.getByRole("button"));
    // The pad replaces the button: there is no state where both are offered,
    // which is what would let someone sign and then hit "add" expecting a save.
    expect(screen.queryByRole("button", { name: /add|update/i })).toBeNull();
  });
});
