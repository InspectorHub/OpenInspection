// @vitest-environment happy-dom
// #478 — the blocking discarded-copy notice: it names what was lost, reviews
// the backup against the current report, recovers a single value, and restores
// the whole backup back into the live doc.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import { FieldDataSourceProvider } from "../../context";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import { applyItemPatch, projectResults, seedResultsDoc } from "../../shared/results-doc";
import type { DiscardedCopyNotice as DiscardedCopyNoticeData } from "../results-doc-connection";
import { DiscardedCopyNotice } from "./DiscardedCopyNotice";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
});

function mount(node: React.ReactElement) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root!.render(node);
    });
}

function bodyText(): string {
    return document.body.textContent ?? "";
}

function buttonByText(re: RegExp): HTMLButtonElement | null {
    const buttons = Array.from(document.body.querySelectorAll("button")) as HTMLButtonElement[];
    return buttons.find((b) => re.test(b.textContent ?? "")) ?? null;
}

function click(el: Element | null) {
    act(() => {
        el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

async function flush() {
    await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
    });
}

const NOTICE: DiscardedCopyNoticeData = {
    kind: "restore",
    atMs: Date.now() - 60_000,
    itemCount: 2,
    backedUp: true,
};

/** Live doc holding one finding (rated RR); the backup holds it as NI plus a second finding. */
function setup(padLiveClock = 0) {
    const live = new Y.Doc();
    live.clientID = 2;
    seedResultsDoc(live, [{ findingKey: "_default:s1:i1" }]);
    applyItemPatch(live, "_default:s1:i1", "rating", "RR");

    const backup = new Y.Doc();
    backup.clientID = 1;
    seedResultsDoc(backup, [{ findingKey: "_default:s1:i1" }, { findingKey: "_default:s1:i2" }]);
    applyItemPatch(backup, "_default:s1:i1", "rating", "NI");
    applyItemPatch(backup, "_default:s1:i2", "rating", "D");
    const update = Y.encodeStateAsUpdate(backup);

    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    fake.collab.readDiscardedBackup = async () => ({ update, atMs: NOTICE.atMs });
    // Dual-keyed like the editor's live ResultMap: composite + bare itemId alias.
    const currentResults = { ...projectResults(live), i1: projectResults(live)["_default:s1:i1"] };
    // Inflate the live doc's clock past the backup's: a bare CRDT merge would
    // then keep the live value (RR) over the backup's (NI) by clock order.
    // The restore must still bring the backup's values back.
    for (let i = 0; i < padLiveClock; i++) applyItemPatch(live, "_default:s1:zz", "notes", `pad-${i}`);
    return { live, fake, currentResults };
}

function noticeUi(overrides: Partial<Parameters<typeof DiscardedCopyNotice>[0]> = {}, padLiveClock = 0) {
    const { live, fake, currentResults } = setup(padLiveClock);
    const onDismiss = vi.fn();
    mount(
        <FieldDataSourceProvider dataSource={fake}>
            <DiscardedCopyNotice
                notice={NOTICE}
                inspectionId="insp-1"
                doc={live}
                currentResults={currentResults}
                onDismiss={onDismiss}
                {...overrides}
            />
        </FieldDataSourceProvider>,
    );
    return { live, fake, onDismiss };
}

describe("DiscardedCopyNotice (#478)", () => {
    it("names what was lost and reviews the backup, recovers one value, and restores the whole backup", async () => {
        const { live, onDismiss } = noticeUi();

        expect(bodyText()).toContain("Your offline copy couldn't be merged");
        expect(bodyText()).toContain("2 findings affected");

        click(buttonByText(/review what was lost/i));
        await flush();
        // The compare shows the backup (NI) against the current report (RR).
        expect(bodyText()).toContain("NI");
        expect(bodyText()).toContain("RR");

        // Per-value recovery writes the OLD value into the live doc.
        click(buttonByText(/recover this value/i));
        expect(projectResults(live)["_default:s1:i1"]?.rating).toBe("NI");
        // The compare's latch reopens one macrotask after a synchronous
        // recovery, so the restore click below needs the same gap.
        await flush();

        // Whole-backup restore asks first, then merges the backup back in.
        click(buttonByText(/restore entire version/i));
        expect(bodyText()).toContain("Restore the backup?");
        const confirmButtons = Array.from(document.body.querySelectorAll("button")).filter((b) =>
            /restore entire version/i.test(b.textContent ?? ""),
        );
        click(confirmButtons.at(-1) ?? null);
        await flush();
        expect(projectResults(live)["_default:s1:i1"]?.rating).toBe("NI");
        expect(projectResults(live)["_default:s1:i2"]?.rating).toBe("D");
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("whole-backup restore wins even when the live doc's clock beats the backup's", async () => {
        // A bare Yjs merge resolves a same-field conflict by clock order, and
        // the live doc's clock is routinely higher — the merge alone would
        // keep RR. The restore re-writes the backup's scalars as fresh edits,
        // so NI and D must come back regardless.
        const { live, onDismiss } = noticeUi({}, 40);

        click(buttonByText(/review what was lost/i));
        await flush();
        expect(bodyText()).toContain("NI");
        expect(bodyText()).toContain("RR");

        click(buttonByText(/restore entire version/i));
        expect(bodyText()).toContain("Restore the backup?");
        const confirmButtons = Array.from(document.body.querySelectorAll("button")).filter((b) =>
            /restore entire version/i.test(b.textContent ?? ""),
        );
        click(confirmButtons.at(-1) ?? null);
        await flush();
        expect(projectResults(live)["_default:s1:i1"]?.rating).toBe("NI");
        expect(projectResults(live)["_default:s1:i2"]?.rating).toBe("D");
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("offers no review when no backup was kept, and dismisses", () => {
        const { onDismiss } = noticeUi({ notice: { ...NOTICE, backedUp: false } });
        expect(bodyText()).toContain("No backup was kept");
        expect(buttonByText(/review what was lost/i)).toBeNull();
        click(buttonByText(/keep current version/i));
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("offers no review when the host cannot read the backup slot", () => {
        const { live, currentResults } = setup();
        const fake = createFakeDataSource({ data: createEmptyEditorData() });
        mount(
            <FieldDataSourceProvider dataSource={fake}>
                <DiscardedCopyNotice
                    notice={NOTICE}
                    inspectionId="insp-1"
                    doc={live}
                    currentResults={currentResults}
                    onDismiss={() => {}}
                />
            </FieldDataSourceProvider>,
        );
        expect(buttonByText(/review what was lost/i)).toBeNull();
    });

    it("renders nothing without a notice", () => {
        noticeUi({ notice: null });
        expect(document.querySelector('[data-testid="discarded-copy-notice"]')).toBeNull();
    });

    it("a backdrop click does not dismiss it", () => {
        const { onDismiss } = noticeUi();
        const backdrop = document.querySelector('[data-testid="discarded-copy-notice"]');
        expect(backdrop).not.toBeNull();
        click(backdrop);
        expect(document.querySelector('[data-testid="discarded-copy-notice"]')).not.toBeNull();
        expect(onDismiss).not.toHaveBeenCalled();
    });
});
