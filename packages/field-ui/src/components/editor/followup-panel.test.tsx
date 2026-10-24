/**
 * @vitest-environment happy-dom
 *
 * F45 — the inspector has to SEE the baseline finding and be able to answer it.
 *
 * Measured before this panel existed: opening a re-inspection's carried item
 * showed the ordinary item panel — ratings, notes, canned comments, photos — and
 * the words "original", "previous", "baseline" and "follow-up" appeared nowhere
 * on the page. `followupStatus` had 1 reference in all of `app/**` (a field
 * whitelist), `isCarried` and `carriedItems` had 0. So the inspector could not
 * see that this item was called a Defect last time and had nowhere to record
 * whether it had been fixed.
 *
 * The discriminating assertions are the two that read the baseline rating and
 * operate the verdict control: a test that only asserted "renders nothing for an
 * ordinary item" passed before the panel existed, because nothing rendered for
 * ANY item.
 *
 * The panel writes through the data source's `set-followup` command, so these tests
 * run it on the provider and a fake data source and assert on the COMMAND it issued.
 * How that command becomes the route's form post is pinned by the web adapter tests
 * (app/lib/field/web-command-encode, web-commands.roundtrip).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CommandResult } from "../../commands";
import { FieldDataSourceProvider } from "../../context";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import type { FakeDataSource } from "../../testing/fake-data-source";
import { FollowupPanel } from "./FollowupPanel";

afterEach(cleanup);

const CARRIED = {
    original: { rating: "Defect", notes: "Cracked crown", photos: [{ key: "a" }, { key: "b" }] },
    followupStatus: null,
};

function mount(result: Record<string, unknown> = CARRIED) {
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    render(
        <FieldDataSourceProvider dataSource={fake}>
            <FollowupPanel inspectionId="insp-1" itemId="chimney" result={result} />
        </FieldDataSourceProvider>,
    );
    return fake;
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe("FollowupPanel", () => {
    it("shows the baseline finding the round was created from", () => {
        mount();
        expect(screen.getByText("Original finding")).toBeInTheDocument();
        expect(screen.getByText("Defect")).toBeInTheDocument();
        expect(screen.getByText(/Cracked crown/)).toBeInTheDocument();
        expect(screen.getByText("2 photos from the original inspection")).toBeInTheDocument();
    });

    it("says out loud that no verdict has been recorded yet", () => {
        mount();
        expect(screen.getByText(/No verdict recorded yet/)).toBeInTheDocument();
    });

    it("records the verdict through the set-followup command", async () => {
        const fake = mount();
        fireEvent.click(screen.getByRole("radio", { name: "Resolved" }));
        await settle();
        expect(fake.commands).toHaveLength(1);
        expect(fake.commands[0]).toMatchObject({
            inspectionId: "insp-1",
            cmd: { type: "set-followup", itemId: "chimney", status: "resolved" },
        });
        // No `notes` key — absent means "leave the note alone", so recording a
        // verdict cannot wipe a note the inspector already wrote.
        expect(Object.keys(fake.commands[0]!.cmd)).not.toContain("notes");
    });

    it("saves the note on blur together with the verdict already recorded", async () => {
        const fake = mount({ ...CARRIED, followupStatus: "resolved", followupNotes: "old" });
        const note = screen.getByRole("textbox");
        fireEvent.change(note, { target: { value: "new note" } });
        fireEvent.blur(note);
        await settle();
        expect(fake.commands.map((c) => c.cmd)).toEqual([
            { type: "set-followup", itemId: "chimney", status: "resolved", notes: "new note" },
        ]);
    });

    it("does not write a note that was not edited", async () => {
        const fake = mount({ ...CARRIED, followupNotes: "same" });
        fireEvent.blur(screen.getByRole("textbox"));
        await settle();
        expect(fake.commands).toEqual([]);
    });

    it("a note saved before any verdict carries no verdict (null clears, it does not invent one)", async () => {
        const fake = mount();
        const note = screen.getByRole("textbox");
        fireEvent.change(note, { target: { value: "first" } });
        fireEvent.blur(note);
        await settle();
        expect(fake.commands.map((c) => c.cmd)).toEqual([
            { type: "set-followup", itemId: "chimney", status: null, notes: "first" },
        ]);
    });

    it("reflects a verdict already in the document, and stops nagging about it", () => {
        mount({ ...CARRIED, followupStatus: "resolved" });
        expect(screen.getByRole("radio", { name: "Resolved" })).toHaveAttribute("aria-checked", "true");
        expect(screen.queryByText(/No verdict recorded yet/)).toBeNull();
    });

    it("relays the server's sentence when the write is refused, and clears it once a write lands", async () => {
        const fake = mount();
        fake.failExecute("set-followup", "unknown follow-up status");
        fireEvent.click(screen.getByRole("radio", { name: "Resolved" }));
        expect(await screen.findByText("unknown follow-up status")).toBeInTheDocument();

        // The host recovers; the next accepted write wipes the sentence.
        vi.spyOn(fake, "execute").mockResolvedValue({ ok: true } as CommandResult<undefined>);
        fireEvent.click(screen.getByRole("radio", { name: "Not resolved" }));
        await waitFor(() => expect(screen.queryByText("unknown follow-up status")).toBeNull());
    });

    it("says it is saving while the write is out", async () => {
        const fake = mount();
        let settleWrite: (r: CommandResult<undefined>) => void = () => undefined;
        vi.spyOn(fake, "execute").mockImplementation((() =>
            new Promise<CommandResult<undefined>>((resolve) => { settleWrite = resolve; })) as FakeDataSource["execute"]);
        fireEvent.click(screen.getByRole("radio", { name: "Resolved" }));
        expect(await screen.findByText(/saving/i)).toBeInTheDocument();
        settleWrite({ ok: true });
        await waitFor(() => expect(screen.queryByText(/saving/i)).toBeNull());
    });

    it("renders NOTHING for an ordinary item with no baseline", () => {
        // An empty "previous round" frame on a normal inspection would promise a
        // baseline there is none of.
        mount({ rating: "Satisfactory" });
        expect(document.querySelector("[data-testid='followup-panel']")).toBeNull();
    });
});

// A verdict is a write that the next round's pre-selection is computed from: two radio presses in ONE
// frame must record ONE verdict (the second is dropped, not queued), and a later press still goes through.
describe("FollowupPanel same-frame guard", () => {
    it("sends ONE command for two verdicts pressed in the same frame", async () => {
        const fake = mount();
        const resolved = screen.getByRole("radio", { name: "Resolved" });
        const notResolved = screen.getByRole("radio", { name: "Not resolved" });
        act(() => { resolved.click(); notResolved.click(); });
        await settle();
        expect(fake.commands).toHaveLength(1);
        expect(fake.commands[0]!.cmd).toMatchObject({ status: "resolved" });
    });

    it("CONTROL - a later press goes through after the first settles", async () => {
        const fake = mount();
        act(() => { screen.getByRole("radio", { name: "Resolved" }).click(); });
        await settle();
        act(() => { screen.getByRole("radio", { name: "Not resolved" }).click(); });
        await settle();
        expect(fake.commands.map((c) => (c.cmd as { status: string }).status)).toEqual(["resolved", "not_resolved"]);
    });
});
