// @vitest-environment happy-dom
// Property-facts autofill is a billed public-records lookup: two clicks dispatched in ONE act()
// reach the action once. The pending button only goes inert after a render, too late for the
// second click.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { PropertyInfoForm } from "./PropertyInfoForm";

afterEach(cleanup);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

function mount(action: () => unknown) {
  const inspection = { propertyType: "single_family", propertyAddress: "123 Main St, Austin, TX 78701" };
  const Stub = createRoutesStub([{ path: "/", Component: () => <PropertyInfoForm inspection={inspection} />, action }]);
  return render(<Stub />);
}

describe("PropertyInfoForm autofill latch", () => {
  it("looks the address up ONCE for two same-frame clicks", async () => {
    const action = vi.fn(() => ({ intent: "autofill-property-facts", facts: null, reason: "NO_API_KEY" }));
    mount(action);
    const btn = screen.getByRole("button", { name: /fetch property details/i });
    act(() => { btn.click(); btn.click(); });
    await settle();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("CONTROL - a later click goes through after the first settles", async () => {
    const action = vi.fn(() => ({ intent: "autofill-property-facts", facts: null, reason: "NO_API_KEY" }));
    mount(action);
    const btn = screen.getByRole("button", { name: /fetch property details/i });
    act(() => { btn.click(); });
    await settle();
    act(() => { btn.click(); });
    await settle();
    expect(action).toHaveBeenCalledTimes(2);
  });
});
