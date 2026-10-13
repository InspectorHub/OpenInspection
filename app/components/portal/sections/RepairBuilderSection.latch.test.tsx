// @vitest-environment happy-dom
// Two clicks on "send by email" dispatched in ONE act() email the client once. The pending
// button only goes inert after a render, which is too late for the second event.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, fireEvent, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { RepairBuilderSection, type LoaderResult } from "./RepairBuilderSection";
import { m } from "~/paraglide/messages";

afterEach(cleanup);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const result: LoaderResult = {
  kind: "ok",
  defects: [],
  mine: [{ id: "rr-1", inspectionId: "i-1", tenantId: "t-1", customIntro: null, shareToken: "share-1", items: [] }],
  tenant: "acme",
  id: "i-1",
  token: "tok",
  quickPhrases: null,
};

function mount(action: () => unknown) {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <RepairBuilderSection result={result} actionPath="/" />, action },
  ]);
  render(<Stub initialEntries={["/"]} />);
  fireEvent.change(screen.getByPlaceholderText(m.repair_share_email_placeholder()), { target: { value: "a@b.co" } });
  return () => screen.getByRole("button", { name: m.repair_share_email_submit() });
}

describe("RepairBuilderSection email latch", () => {
  it("emails ONCE for two same-frame clicks, and again after the first send settles", async () => {
    // A refusal keeps the form on screen so a later click is possible.
    const action = vi.fn(async () => ({ ok: false, error: "nope" }));
    const send = mount(action);
    act(() => { send().click(); send().click(); });
    await settle();
    expect(action).toHaveBeenCalledTimes(1);

    act(() => { send().click(); });
    await settle();
    expect(action).toHaveBeenCalledTimes(2);
  });
});
