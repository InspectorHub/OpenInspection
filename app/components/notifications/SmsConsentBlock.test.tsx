/**
 * The consent block, and the one control it deliberately does NOT have.
 *
 * Granting SMS consent means recording a disclosure version, a capture method,
 * an ip and a user agent. Only the opt-in page can honestly produce that, so a
 * switch here would be manufacturing evidence — the block offers Stop, and
 * sends the reader out to grant.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { SmsConsentBlock, type SmsConsent } from "./SmsConsentBlock";

const DISCLOSURE = { version: 3, text: "Message and data rates may apply." };
const base: SmsConsent = {
  phone: "+1 555 000 1111", state: "granted", at: "2026-06-12T00:00:00.000Z",
  capturedVia: "booking_form", disclosure: DISCLOSURE,
};

function setup(consent: Partial<SmsConsent> = {}, manageHref?: string) {
  const onStop = vi.fn();
  const onGrant = vi.fn();
  const utils = render(
    <SmsConsentBlock
      consent={{ ...base, ...consent }}
      onStop={onStop}
      onGrant={onGrant}
      manageHref={manageHref}
    />,
  );
  return { ...utils, onStop, onGrant };
}

describe("SMS consent block", () => {
  it("formats the ledger date in the APP's locale, not the browser's", () => {
    // `toLocaleDateString(undefined, …)` reads navigator.language and printed a
    // Chinese date inside an English page. Caught in Chrome, not here.
    const c = setup();
    expect(c.getByText(/Jun 1[23], 2026/)).toBeTruthy();
  });

  it("shows the number, and when and how consent was captured", () => {
    // The ledger IS the compliance evidence. Showing it costs nothing and
    // turns a record we must keep anyway into something the reader benefits from.
    const c = setup();
    expect(c.getByText(/\+1 555 000 1111/)).toBeTruthy();
    expect(c.getByText(/booking form/i)).toBeTruthy();
  });

  it("offers Stop while texts are on", () => {
    const c = setup();
    c.getByText(/Stop texts/i).click();
    expect(c.onStop).toHaveBeenCalled();
  });

  it("offers a way BACK ON after a stop — otherwise the block is a dead end", () => {
    // Shipped as a dead end and caught in the browser: stopped, no Stop button
    // (correct), and no way to return (not).
    const c = setup({ state: "revoked" });
    expect(c.queryByText(/Stop texts/i)).toBeNull();
    expect(c.getByText(/Turn texts on/i)).toBeTruthy();
  });

  it("will not grant until the reader has acknowledged the disclosure", () => {
    // The disclosure is on screen and its VERSION travels with the grant. That
    // is the whole difference between recording consent and inventing it.
    const c = setup({ state: "revoked" });
    const button = c.getByText(/Turn texts on/i).closest("button")!;
    expect(button.disabled).toBe(true);

    c.container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click();
    expect(c.getByText(/Turn texts on/i).closest("button")!.disabled).toBe(false);
    c.getByText(/Turn texts on/i).closest("button")!.click();
    expect(c.onGrant).toHaveBeenCalledWith(3);
  });

  it("offers no inline grant when there is no disclosure to show", () => {
    // No text means nothing the reader could have agreed to.
    const c = setup({ state: "revoked", disclosure: null });
    expect(c.queryByText(/Turn texts on/i)).toBeNull();
  });

  it("says an agent is reachable under the relationship, without claiming a grant", () => {
    // Implied consent has no grant date to show. Printing one would be
    // inventing evidence; saying nothing would look like a bug.
    const c = setup({ state: "implied", at: null, capturedVia: null });
    expect(c.getByText(/already doing together/i)).toBeTruthy();
    expect(c.getByText(/Stop texts/i)).toBeTruthy();
  });

  it("distinguishes “you stopped” from “you never asked”", () => {
    // Both are OFF, but only one is a decision the reader made. Collapsing them
    // would tell someone they opted out of something they never saw.
    expect(setup({ state: "revoked" }).getByText(/You stopped them/i)).toBeTruthy();
    expect(setup({ state: "none", at: null, capturedVia: null }).getByText(/no record that you asked/i)).toBeTruthy();
  });
});
