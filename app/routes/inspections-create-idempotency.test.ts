// @vitest-environment node
/**
 * portal #105 — the hand-off that makes client-side guarding actually dedupe.
 *
 * `useGuardedSubmit` cannot set a header (`fetcher.submit()` takes none) and
 * this app is a BFF, so the wizard's key travels in the FORM BODY under
 * `IDEMPOTENCY_FIELD`. The server middleware keys off the `Idempotency-Key`
 * HEADER. Between the two sits the create action: if it does not lift the field
 * onto the header, both halves are live and nothing is guarded — the wizard
 * mints a key that nothing ever reads.
 *
 * These tests run the real action against the real middleware over a real
 * (in-memory) D1 schema, with the create endpoint replaced by a recorder, so
 * "a second inspection was created" is observed rather than inferred.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";

import { createTestDb, setupSchema } from "../../tests/unit/db";
import { idempotencyMiddleware } from "../../server/lib/middleware/idempotency";
import { IDEMPOTENCY_FIELD } from "~/hooks/useGuardedSubmit";

/** Mutable seam the mocked api-client reaches through — set per test. */
const seam = vi.hoisted(() => ({
    post: null as null | ((args: { json: unknown }, options?: { headers?: Record<string, string> }) => Promise<Response>),
}));

vi.mock("~/lib/session.server", () => ({
    requireToken: vi.fn().mockResolvedValue("tok"),
}));
vi.mock("~/lib/api-client.server", () => ({
    createApi: () => ({
        inspections: {
            index: {
                $post: (args: { json: unknown }, options?: { headers?: Record<string, string> }) =>
                    seam.post!(args, options),
            },
        },
    }),
}));

import { action } from "~/routes/inspections";

let db: ReturnType<typeof createTestDb>["db"];
let created: Record<string, unknown>[] = [];

/**
 * A stand-in for the mounted API: the same middleware, in the same position
 * relative to a tenant-bearing context, in front of a handler that records
 * every create it is asked to perform.
 */
function buildApiApp() {
    const app = new Hono();
    app.use("*", async (c, next) => {
        c.set("tenantId", "t1");
        await next();
    });
    app.use("*", idempotencyMiddleware({ getDb: () => db as never }));
    app.post("/api/inspections", async (c) => {
        const body = (await c.req.json()) as Record<string, unknown>;
        created.push(body);
        return c.json({ data: { inspection: { id: `insp-${created.length}` } } }, 201);
    });
    return app;
}

function submit(key: string, overrides: Record<string, string> = {}) {
    const body = new URLSearchParams({
        intent: "create",
        address: "123 Main St",
        templateId: "11111111-1111-4111-8111-111111111111",
        [IDEMPOTENCY_FIELD]: key,
        ...overrides,
    });
    const request = new Request("https://x/inspections", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return action({ request, params: {}, context: {} as any }) as Promise<Response>;
}

describe("POST /inspections (create) — idempotency key hand-off", () => {
    beforeEach(async () => {
        const t = createTestDb();
        await setupSchema(t.sqlite);
        db = t.db;
        created = [];
        const api = buildApiApp();
        seam.post = (args, options) =>
            api.request("/api/inspections", {
                method: "POST",
                headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
                body: JSON.stringify(args.json),
            });
    });

    it("forwards the submitted key as the Idempotency-Key header", async () => {
        let seen: string | null = "MISSING";
        seam.post = async (_args, options) => {
            seen = options?.headers?.["Idempotency-Key"] ?? null;
            return new Response(JSON.stringify({ data: { inspection: { id: "x" } } }), { status: 201 });
        };
        await submit("key-1");
        expect(seen).toBe("key-1");
    });

    it("does not create a second inspection when the same key is submitted twice", async () => {
        const first = await submit("key-1");
        const second = await submit("key-1");

        expect(created).toHaveLength(1);
        // Both callers must land on the SAME inspection. A replay that returned
        // a fresh id would mean a second row was written after all.
        expect(first.headers.get("location")).toBe("/inspections/insp-1/edit");
        expect(second.headers.get("location")).toBe("/inspections/insp-1/edit");
    });

    it("still creates when the wizard rotates to a fresh key", async () => {
        await submit("key-1");
        await submit("key-2");
        expect(created).toHaveLength(2);
    });

    it("never persists the key into the created inspection", async () => {
        await submit("key-1");
        expect(created[0]).not.toHaveProperty(IDEMPOTENCY_FIELD);
        expect(Object.keys(created[0])).toEqual(
            expect.not.arrayContaining([IDEMPOTENCY_FIELD]),
        );
    });
});
