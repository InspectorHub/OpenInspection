// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PublishReadiness } from "@core/field-ui/shared/types";
import { createWebPublishReadiness } from "./web-publish-readiness";

const readiness: PublishReadiness = { ready: false, blockingDefects: [], warningDefects: [] };

function answer(body: unknown, init: ResponseInit = {}): typeof fetch {
    return vi.fn(async () => new Response(JSON.stringify(body), { status: 200, ...init })) as unknown as typeof fetch;
}

describe("createWebPublishReadiness", () => {
    it("asks the resource route for this inspection with the session, and returns the verdict", async () => {
        const fetchImpl = answer({ readiness });
        await expect(createWebPublishReadiness(fetchImpl).check("a b")).resolves.toEqual(readiness);
        expect(fetchImpl).toHaveBeenCalledWith("/resources/publish-readiness?id=a%20b", { credentials: "include" });
    });

    it("answers null when the route has no verdict, is refused, or the body is not JSON", async () => {
        await expect(createWebPublishReadiness(answer({ readiness: null })).check("i")).resolves.toBeNull();
        await expect(createWebPublishReadiness(answer({})).check("i")).resolves.toBeNull();
        const refused = vi.fn(async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
        await expect(createWebPublishReadiness(refused).check("i")).resolves.toBeNull();
        const html = vi.fn(async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
        await expect(createWebPublishReadiness(html).check("i")).resolves.toBeNull();
    });

    it("never rejects: a network failure answers null", async () => {
        const down = vi.fn(async () => {
            throw new Error("offline");
        }) as unknown as typeof fetch;
        await expect(createWebPublishReadiness(down).check("i")).resolves.toBeNull();
    });
});
