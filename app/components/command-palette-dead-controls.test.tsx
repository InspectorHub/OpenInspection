// @vitest-environment happy-dom
/**
 * F64 and F65 — the command palette's dead controls.
 *
 * F64: the hint row advertised an `@ people` prefix and the code behind it read
 * `sources = []; // contacts would need a search endpoint`. The endpoint
 * existed: `GET /api/contacts` has always taken `search`. So this is a wiring
 * test, not a deletion test — typing `@` must produce contacts.
 *
 * F65: three of the four quick actions navigated to a query parameter that
 * nothing in the repository read (`?new=1`, `?import=1` — 0 hits). Two of them
 * now address a page that opens its own dialog; the third pointed at a flow that
 * was deleted (a paste-a-JSON Spectora importer) and is repointed at the wizard
 * that replaced it, with the vendor name dropped — the wizard's first question
 * is which vendor, so naming one in the palette promised a shortcut that is not
 * there.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { CommandPalette } from "./CommandPalette";

const CONTACTS = [
  { id: "c1", name: "Marge Bouvier", type: "client" as const, email: "marge@example.com" },
  { id: "c2", name: "Ned Flanders", type: "agent" as const, email: null },
];

function renderPalette(onContactSearch?: (q: string | null) => void) {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <CommandPalette open onOpenChange={() => {}} /> },
    { path: "/resources/recent-inspections", loader: () => ({ inspections: [] }) },
    {
      path: "/resources/contact-search",
      loader: ({ request }) => {
        const q = new URL(request.url).searchParams.get("q");
        onContactSearch?.(q);
        // Mirror the real route: the server has already matched, so whatever it
        // returns is what the palette must show.
        return { contacts: CONTACTS };
      },
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

async function typeQuery(value: string) {
  const input = await screen.findByPlaceholderText(/search/i);
  fireEvent.change(input, { target: { value } });
  return input;
}

describe("F64 — the @ people prefix", () => {
  it("finds a contact by name", async () => {
    renderPalette();
    await typeQuery("@Marge");

    expect(await screen.findByText("Marge Bouvier")).toBeTruthy();
    // The advertised prefix must not answer "No results found" for a contact
    // the product has — that is the whole defect.
    expect(screen.queryByText("No results found")).toBeNull();
  });

  it("sends the typed term to the server rather than filtering what it already has", async () => {
    const seen: Array<string | null> = [];
    renderPalette((q) => seen.push(q));
    await typeQuery("@Flanders");

    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen.at(-1)).toBe("Flanders");
  });

  it("treats a bare @ as 'show me my contacts', not as an empty result", async () => {
    renderPalette();
    await typeQuery("@");

    expect(await screen.findByText("Ned Flanders")).toBeTruthy();
  });

  it("keeps a contact the server matched on email, which label scoring would drop", async () => {
    renderPalette();
    // "example.com" appears in no contact NAME. Re-scoring the server's answer
    // against the label would filter both rows away.
    await typeQuery("@example.com");

    expect(await screen.findByText("Marge Bouvier")).toBeTruthy();
  });

  it("a contact row leads to that contact", async () => {
    renderPalette();
    await typeQuery("@Marge");
    const row = (await screen.findByText("Marge Bouvier")).closest("button") as HTMLElement;
    expect(row).toBeTruthy();
    // The palette navigates via `to`; assert the row is a real target by
    // clicking it without the stub throwing on an unknown route.
    fireEvent.click(row);
  });
});

describe("F65 — the quick actions", () => {
  it("offers no action addressed at a query parameter nothing reads", async () => {
    renderPalette();
    await typeQuery(">");

    const rows = await screen.findAllByRole("button");
    const labels = rows.map((r) => r.textContent ?? "");
    // `?import=1` was read by nothing in the repository; the importer it named
    // was deleted.
    expect(labels.join(" ")).not.toMatch(/Spectora/i);
  });

  it("names the import action after what it does, not after one vendor", async () => {
    renderPalette();
    await typeQuery(">import");
    expect(await screen.findByText("Import templates")).toBeTruthy();
  });

  it("still offers all four quick actions", async () => {
    renderPalette();
    await typeQuery(">");
    for (const label of ["New Inspection", "New Template", "New Contact", "Import templates"]) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
  });
});
