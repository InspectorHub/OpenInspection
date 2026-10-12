// @vitest-environment happy-dom
/**
 * A fast double click on Connect or Disconnect must post the intent once.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { useForm } from "@conform-to/react";
import type { StripeConnectInput } from "~/lib/forms/settings-config.schema";
import { StripeConnectPanel } from "./StripeConnectPanel";

afterEach(cleanup);

function Harness({ connected }: { connected: boolean }) {
  const [form, fields] = useForm<StripeConnectInput>({});
  return (
    <StripeConnectPanel
      stripeConnected={connected}
      stripeAccountId="acct_123"
      stripeForm={form}
      stripeFields={fields}
    />
  );
}

async function doubleClick(connected: boolean, label: RegExp) {
  let calls = 0;
  let release: () => void = () => {};
  const Stub = createRoutesStub([
    {
      path: "/settings",
      Component: () => <Harness connected={connected} />,
      action: async () => {
        calls += 1;
        await new Promise<void>((resolve) => { release = resolve; });
        return null;
      },
    },
  ]);
  render(<Stub initialEntries={["/settings"]} />);
  const button = await screen.findByRole("button", { name: label });
  act(() => { button.click(); button.click(); });
  await waitFor(() => expect(calls).toBe(1));
  expect(calls).toBe(1);
  await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
  await act(async () => { release(); });
}

describe("StripeConnectPanel", () => {
  it("connect: reaches the action once when clicked twice in one frame", async () => {
    await doubleClick(false, /connect/i);
  });

  it("disconnect: reaches the action once when clicked twice in one frame", async () => {
    await doubleClick(true, /disconnect/i);
  });
});
