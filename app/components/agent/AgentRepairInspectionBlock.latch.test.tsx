// @vitest-environment happy-dom
// Two clicks in ONE act() create one repair_requests row and send one email. The pending state
// only lands after a render, which is too late for the second event.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, fireEvent, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { AgentRepairInspectionBlock } from "./AgentRepairInspectionBlock";
import type { AgentRepairAccess } from "~/lib/agent-repair-access";
import { m } from "~/paraglide/messages";

afterEach(cleanup);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const WRITE_ACCESS: AgentRepairAccess = "readwrite";

function mount(action: (a: { request: Request }) => unknown) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <AgentRepairInspectionBlock
          inspectionId="i-1"
          tenantName="Acme"
          tenantSlug="acme"
          repairAccess={WRITE_ACCESS}
          rows={[]}
          photosFor={() => []}
        />
      ),
      action,
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

describe("AgentRepairInspectionBlock latch", () => {
  it("shares ONCE for two same-frame clicks", async () => {
    const action = vi.fn(async () => ({ ok: false, error: "nope" }));
    mount(action);
    const share = () => screen.getByTestId("repair-share-i-1");
    act(() => { share().click(); share().click(); });
    await settle();
    expect(action).toHaveBeenCalledTimes(1);

    act(() => { share().click(); });
    await settle();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("emails ONCE for two same-frame clicks, and again after the first send settles", async () => {
    const action = vi.fn(async ({ request }: { request: Request }) => {
      const intent = (await request.formData()).get("_intent");
      return intent === "share" ? { ok: true, shareToken: "share-1" } : { ok: false, error: "nope" };
    });
    mount(action);
    act(() => { screen.getByTestId("repair-share-i-1").click(); });
    await settle();
    fireEvent.change(screen.getByPlaceholderText(m.repair_share_email_placeholder()), { target: { value: "a@b.co" } });
    const send = () => screen.getByRole("button", { name: m.repair_share_email_submit() });
    const emails = () => action.mock.calls.length - 1;

    act(() => { send().click(); send().click(); });
    await settle();
    expect(emails()).toBe(1);

    act(() => { send().click(); });
    await settle();
    expect(emails()).toBe(2);
  });
});
