// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { createRoutesStub } from "react-router";
import { render, screen, cleanup, act } from "@testing-library/react";
import { ContactQboSection } from "./ContactQboSection";
import type { ContactQbo } from "~/lib/contact-qbo.server";

afterEach(cleanup);

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const MATCHED: ContactQbo = {
  connected: true,
  link: { linked: true, qboCustomerId: "58", displayName: "Amy Co", openErrorCount: 0 },
};

async function mount(qbo: ContactQbo, archived: boolean, answer: (fields: Record<string, string>) => unknown) {
  const seen: Array<Record<string, string>> = [];
  const Stub = createRoutesStub([{
    path: "/contacts/:id",
    Component: () => <ContactQboSection qbo={qbo} contact={{ id: "c-1", name: "Rosa", archived }} />,
    action: async ({ request }: { request: Request }) => {
      const fields = Object.fromEntries([...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]));
      seen.push(fields);
      return answer(fields);
    },
  }]);
  await act(async () => { render(<Stub initialEntries={["/contacts/c-1"]} />); });
  return seen;
}

async function confirmRemove() {
  await act(async () => { screen.getByRole("button", { name: "Remove match" }).click(); });
  const confirm = Array.from(screen.getByRole("dialog").querySelectorAll("button")).find((b) => b.textContent === "Remove match")!;
  await act(async () => { confirm.click(); });
  await settle();
}

describe("ContactQboSection", () => {
  it("submits the unlink intent once the removal is confirmed, with no contact id in the body", async () => {
    const seen = await mount(MATCHED, false, (f) => ({ success: true, intent: f.intent, error: null, unlinked: { ok: true } }));
    expect(seen).toHaveLength(0);
    await confirmRemove();
    expect(seen).toHaveLength(1);
    expect(seen[0].intent).toBe("qbo-unlink-customer");
    expect(seen[0]).not.toHaveProperty("contactId");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when the removal fails", async () => {
    await mount(MATCHED, false, (f) => ({ success: false, intent: f.intent, error: null, unlinked: { ok: false, reason: "other" } }));
    await confirmRemove();
    expect(screen.getByRole("alert")).toHaveTextContent("could not be removed");
  });

  it("opens the matching dialog for this contact, showing the match it already has", async () => {
    await mount(MATCHED, false, () => ({}));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => { screen.getByRole("button", { name: "Change match" }).click(); });
    expect(screen.getByRole("dialog")).toHaveTextContent("Rosa");
    expect(screen.getByRole("dialog")).toHaveTextContent("Currently matched to Amy Co");
  });

  it("renders nothing when not connected", async () => {
    await mount({ connected: false, link: { linked: false, qboCustomerId: null, displayName: null, openErrorCount: 0 } }, false, () => ({}));
    expect(screen.queryByText("QuickBooks")).not.toBeInTheDocument();
  });
});
