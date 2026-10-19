// @vitest-environment happy-dom
/**
 * Deleting an event type: the list is the loader's data. A delete the server
 * confirms removes the row and re-reads the list; one it refuses (or that never
 * reaches the server) leaves the row in place and says so.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import SettingsEventTypes from "~/routes/settings-event-types";

const T1 = { id: "et1", name: "Sewer scope", slug: "sewer", defaultDurationMin: 45, defaultPriceCents: 15000, color: "#4a72ff", sortOrder: 0, active: true, followUpDelayHours: 72 };
const T2 = { ...T1, id: "et2", name: "Radon test", slug: "radon" };

let reads = 0;
let serverRows: Array<typeof T1>;
function mount() {
    const Stub = createRoutesStub([
        {
            path: "/settings/event-types",
            Component: SettingsEventTypes,
            loader: () => { reads += 1; return { types: serverRows, loadFailed: false }; },
        },
    ]);
    return render(<Stub initialEntries={["/settings/event-types"]} />);
}
const clickDelete = async (name: string) => {
    const row = (await screen.findByText(name)).closest("tr")!;
    fireEvent.click([...row.querySelectorAll("button")].find((b) => b.textContent === "Delete")!);
};

describe("settings → event types: delete", () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => { reads = 0; serverRows = [T1, T2]; });
    afterEach(() => vi.unstubAllGlobals());

    it("a confirmed delete removes the row and re-reads the list", async () => {
        fetchMock = vi.fn(async () => { serverRows = [T2]; return new Response("{}", { status: 200 }); });
        vi.stubGlobal("fetch", fetchMock);
        mount();
        await clickDelete("Sewer scope");
        await waitFor(() => expect(screen.queryByText("Sewer scope")).toBeNull());
        await waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
        expect(screen.getByText("Radon test")).toBeTruthy();
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it.each([
        ["the server refuses", () => new Response(JSON.stringify({ error: { message: "Not allowed" } }), { status: 403 })],
        ["the request cannot be made", () => { throw new TypeError("network"); }],
    ] as Array<[string, () => Response]>)("keeps the row and shows an error when %s", async (_n, answer) => {
        fetchMock = vi.fn(async () => answer());
        vi.stubGlobal("fetch", fetchMock);
        mount();
        await clickDelete("Sewer scope");
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toMatch(/could not be deleted/i);
        expect(screen.getByText("Sewer scope")).toBeTruthy();
    });
});
