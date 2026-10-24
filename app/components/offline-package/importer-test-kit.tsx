/**
 * Shared harness for the importer specs: `fetch` stubbed so the real
 * `sendOfflinePackage` and `runImport` run, and helpers that drive the page
 * through its real controls.
 */
import { vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ImportOptions } from "@core/offline-package";

import { OfflinePackageImporter } from "~/components/offline-package/OfflinePackageImporter";
import { makeCase } from "../../../tests/unit/helpers/offline-package-cases";
import { confirmedFor } from "../../../tests/unit/helpers/offline-package-harness";

export type Answer = { status: number; body: unknown };
// i18n-literal-ok: a test-only type naming the "throw" sentinel, not text a person reads
export type Respond =(call: number, bytes: Uint8Array) => Answer | "throw" | Promise<Answer | "throw">;

export const NO_WAIT: ImportOptions = { sleep: async () => {} };
export const SIGNED_OUT_SENTENCE = /Your session may have expired or you may not have permission to import\./;

export function ok(bytes: Uint8Array, extra: { failed?: unknown[]; skipped?: number; applied?: number } = {}): Answer {
    const sent = confirmedFor(bytes, extra);
    return { status: sent.status, body: sent.body };
}

export function refused(status: number, code: string, details?: Record<string, unknown>): Answer {
    return { status, body: { success: false, error: { code, message: code, ...(details ? { details } : {}) } } };
}

/** Replaces `fetch`; records each request's package. Reading the Blob is async, so the answer is too. */
export function stubNetwork(respond: Respond) {
    const requests: Uint8Array[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const bytes = new Uint8Array(await (init.body as Blob).arrayBuffer());
        requests.push(bytes);
        const answer = await respond(requests.length, bytes);
        if (answer === "throw") throw new TypeError("network down");
        return { status: answer.status, text: async () => JSON.stringify(answer.body) } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return { fetchMock, requests };
}

export function fileOf(bytes: Uint8Array | string, name = "export.zip"): File {
    return new File([bytes as BlobPart], name, { type: "application/zip" });
}

export function renderPage(tenantId = "tenant-1") {
    return render(<OfflinePackageImporter tenantId={tenantId} locale="en" timeZone="UTC" importOptions={NO_WAIT} />);
}

export async function choose(file: File) {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
        fireEvent.change(input, { target: { files: [file] } });
    });
}

export async function openConfirm() {
    await act(async () => {
        fireEvent.click(await screen.findByRole("button", { name: "Review and import" }));
    });
    return screen.findByRole("dialog");
}

export async function confirmImport() {
    const dialog = await openConfirm();
    await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: "Import package" }));
    });
}

export async function runToResult(pack: { zip: Uint8Array }, respond: Respond) {
    const net = stubNetwork(respond);
    renderPage();
    await choose(fileOf(pack.zip));
    await confirmImport();
    await screen.findByTestId("offline-package-result");
    return net;
}

export const three = makeCase({ inspections: 3, photos: { 0: 1 }, updates: { 1: 1 } });
