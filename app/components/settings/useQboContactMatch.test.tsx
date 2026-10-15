// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoutesStub } from "react-router";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { useQboContactMatch } from "./useQboContactMatch";
import type { QBOSyncErrorSummary } from "../../../server/services/qbo/api-base";

afterEach(cleanup);

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const ERROR: QBOSyncErrorSummary = {
  id: "e1", oiType: "contact", oiId: "contact-1", contactName: null, errorCode: "SYNC_ERROR", message: "x", retries: 1, lastSeenAt: 1,
};

let current: QBOSyncErrorSummary = ERROR;

function Harness() {
  const match = useQboContactMatch();
  return (
    <>
      <button type="button" onClick={() => match.open(current)}>open</button>
      {match.dialog}
    </>
  );
}

async function mount(answers: (fields: Record<string, string>) => unknown) {
  const seen: Array<Record<string, string>> = [];
  const Stub = createRoutesStub([{
    path: "/",
    Component: Harness,
    action: async ({ request }: { request: Request }) => {
      const fields = Object.fromEntries([...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]));
      seen.push(fields);
      return answers(fields);
    },
  }]);
  await act(async () => { render(<Stub initialEntries={["/"]} />); });
  return seen;
}

describe("useQboContactMatch", () => {
  it("names the contact in the dialog when the row carries a name, and falls back when it does not", async () => {
    await mount(() => ({ success: true }));
    current = { ...ERROR, contactName: "Alice Adams" };
    await act(async () => { screen.getByRole("button", { name: "open" }).click(); });
    expect(screen.getByRole("dialog")).toHaveTextContent("that Alice Adams should be matched");
    cleanup();

    await mount(() => ({ success: true }));
    current = { ...ERROR, contactName: null };
    await act(async () => { screen.getByRole("button", { name: "open" }).click(); });
    expect(screen.getByRole("dialog")).toHaveTextContent("that this contact should be matched");
    current = ERROR;
  });

  it("searches and links through the route's action, then closes", async () => {
    const seen = await mount((f) => f.intent === "qbo-search-customers"
      ? {
          success: true, intent: f.intent, error: null,
          search: { ok: true, customers: [{ id: "58", displayName: "Amy Co", companyName: null, email: null, linkedContactId: null, linkedContactName: null }] },
        }
      : { success: true, intent: f.intent, error: null, linked: { ok: true, displayName: "Amy Co" } });

    // Control: no dialog until the row button asks for it.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => { screen.getByRole("button", { name: "open" }).click(); });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search QuickBooks customers"), { target: { value: "amy" } });
    await act(async () => { fireEvent.submit(screen.getByLabelText("Search QuickBooks customers").closest("form")!); });
    await settle();
    expect(seen.map((s) => ({ intent: s.intent, q: s.q }))).toEqual([{ intent: "qbo-search-customers", q: "amy" }]);

    await act(async () => { screen.getByRole("button", { name: /Amy Co/ }).click(); });
    await act(async () => { screen.getByRole("button", { name: "Match contact" }).click(); });
    await settle();
    expect(seen[1]).toMatchObject({ intent: "qbo-link-customer", contactId: "contact-1", qboCustomerId: "58" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the refusal and stays open when the action answers one", async () => {
    await mount((f) => f.intent === "qbo-search-customers"
      ? { success: true, intent: f.intent, error: null, search: { ok: true, customers: [{ id: "58", displayName: "Amy Co", companyName: null, email: null, linkedContactId: null, linkedContactName: null }] } }
      : { success: false, intent: f.intent, error: null, linked: { ok: false, reason: "inactive" } });
    await act(async () => { screen.getByRole("button", { name: "open" }).click(); });
    fireEvent.change(screen.getByLabelText("Search QuickBooks customers"), { target: { value: "amy" } });
    await act(async () => { fireEvent.submit(screen.getByLabelText("Search QuickBooks customers").closest("form")!); });
    await settle();
    await act(async () => { screen.getByRole("button", { name: /Amy Co/ }).click(); });
    await act(async () => { screen.getByRole("button", { name: "Match contact" }).click(); });
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("inactive");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("reads a missing answer as a failure rather than hanging", async () => {
    const onAnswer = vi.fn(() => ({ success: false }));
    await mount(onAnswer);
    await act(async () => { screen.getByRole("button", { name: "open" }).click(); });
    fireEvent.change(screen.getByLabelText("Search QuickBooks customers"), { target: { value: "amy" } });
    await act(async () => { fireEvent.submit(screen.getByLabelText("Search QuickBooks customers").closest("form")!); });
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("The search could not be completed");
  });
});
