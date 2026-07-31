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

const base: SmsConsent = { phone: "+1 555 000 1111", state: "granted", at: "2026-06-12T00:00:00.000Z", capturedVia: "booking_form" };

function setup(consent: Partial<SmsConsent> = {}, manageHref?: string) {
  const onStop = vi.fn();
  const utils = render(
    <SmsConsentBlock consent={{ ...base, ...consent }} onStop={onStop} manageHref={manageHref} />,
  );
  return { ...utils, onStop };
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

  it("offers NO way to switch consent back on, only a way out to the opt-in page", () => {
    const c = setup({ state: "revoked" }, "/sms-optin/abc");
    expect(c.queryByText(/Stop texts/i)).toBeNull();
    expect(c.getByText(/Manage texts/i)).toBeTruthy();
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
