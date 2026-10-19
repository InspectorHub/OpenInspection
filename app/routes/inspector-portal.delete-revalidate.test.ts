// @vitest-environment node
/**
 * Once the inspection is deleted, the hub page must not re-run its own loader:
 * the record is gone, so the loader answers "not found" and the page turns into
 * an error before it can leave for the list. Every other submission still
 * refreshes the page.
 */
import { describe, it, expect } from "vitest";
import { shouldRevalidate } from "~/routes/inspector-portal";

const call = (intent: string, actionResult: unknown) =>
    shouldRevalidate({ formData: new URLSearchParams({ intent }) as unknown as FormData, actionResult, defaultShouldRevalidate: true } as never);

describe("hub shouldRevalidate", () => {
    it("skips the reload after a delete that succeeded", () => {
        expect(call("delete", { ok: true, intent: "delete" })).toBe(false);
    });
    it("still reloads after a delete that failed, so the page stays truthful", () => {
        expect(call("delete", { ok: false, intent: "delete" })).toBe(true);
    });
    it("still reloads after any other action", () => {
        expect(call("publish", { ok: true, intent: "publish" })).toBe(true);
    });
});
