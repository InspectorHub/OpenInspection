// @vitest-environment happy-dom
/**
 * An in-flight reminder is aria-disabled, never natively disabled: the verify dialog that
 * `onRemind` opens would otherwise record <body> as its focus-return target.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SignerList, type SignerRow } from "./SignerList";

afterEach(cleanup);

const SIGNERS: SignerRow[] = [
  { id: "s1", name: "Ada", email: "ada@example.com", role: "client", status: "sent" },
];

describe("SignerList remind button while a reminder is in flight", () => {
  it("is aria-disabled without a disabled attribute, and swallows a second click", () => {
    const onRemind = vi.fn(() => new Promise<void>(() => {}));
    render(<SignerList signers={SIGNERS} onRemind={onRemind} nowMs={1_000_000} />);
    const [remind] = screen.getAllByRole("button");
    fireEvent.click(remind);
    expect(onRemind).toHaveBeenCalledTimes(1);

    const pending = screen.getAllByRole("button")[0];
    expect(pending.getAttribute("aria-disabled")).toBe("true");
    expect(pending.hasAttribute("disabled")).toBe(false);
    fireEvent.click(pending);
    expect(onRemind).toHaveBeenCalledTimes(1);
  });

  it("keeps a rate-limited signer natively disabled", () => {
    const rows = [{ ...SIGNERS[0], lastRemindedAt: 999_000 }];
    render(<SignerList signers={rows} onRemind={vi.fn()} nowMs={1_000_000} />);
    const remind = screen.getAllByRole("button")[0];
    expect(remind.hasAttribute("disabled")).toBe(true);
  });
});
