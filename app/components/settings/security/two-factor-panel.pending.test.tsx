// @vitest-environment happy-dom
/** While a request is in flight the entry buttons are aria-disabled, so focus stays put. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TwoFactorPanel } from "./TwoFactorPanel";

const guarded = vi.hoisted(() => ({ busy: true }));

vi.mock("~/hooks/useGuardedSubmit", () => ({
  useGuardedSubmit: () => ({
    submit: vi.fn(() => true),
    fetcher: { state: "idle", data: undefined },
    busy: guarded.busy,
  }),
}));
vi.mock("react-router", () => ({
  useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }),
}));

afterEach(cleanup);

describe("TwoFactorPanel entry buttons", () => {
  it("Enable 2FA is aria-disabled, not natively disabled, while busy", () => {
    guarded.busy = true;
    render(<TwoFactorPanel totpEnabled={false} />);
    const enable = screen.getAllByRole("button")[0];
    expect(enable.getAttribute("aria-disabled")).toBe("true");
    expect(enable.hasAttribute("disabled")).toBe(false);
    fireEvent.click(enable);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Enable 2FA is not aria-disabled when idle", () => {
    guarded.busy = false;
    render(<TwoFactorPanel totpEnabled={false} />);
    expect(screen.getAllByRole("button")[0].hasAttribute("aria-disabled")).toBe(false);
  });
});
