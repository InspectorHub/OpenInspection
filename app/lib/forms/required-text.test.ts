// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseWithZod } from "@conform-to/zod/v4";
import type { ZodType } from "zod";
import * as auth from "./auth.schema";
import * as contacts from "./contacts.schema";
import * as settings from "./settings.schema";
import * as settingsConfig from "./settings-config.schema";
import * as roleProfile from "./role-profile.schema";

/**
 * Submitting a form with a required field left blank must say what to do about
 * it. On Settings → Services it said "Invalid input" — zod's own words for a
 * value it did not receive.
 *
 * The cause is a trap in the Conform + zod combination rather than a typo:
 * Conform strips blank values, so a `z.string().min(1, "Enter a name")` field
 * arrives as `undefined`, `min` never runs, and the default surfaces. Every
 * required text field in the app was written that way, so this walks all of them
 * through the real `parseWithZod` path with nothing filled in and insists on a
 * message a person can act on.
 *
 * It is deliberately a sweep over the whole module rather than one case per
 * field: the next form to be added would otherwise reintroduce this quietly.
 */
const MODULES: Array<[string, Record<string, unknown>]> = [
    ["auth", auth],
    ["contacts", contacts],
    ["settings", settings],
    ["settings-config", settingsConfig],
    ["role-profile", roleProfile],
];

function schemaFactories(): Array<[string, () => ZodType]> {
    const out: Array<[string, () => ZodType]> = [];
    for (const [prefix, mod] of MODULES) {
        for (const [name, value] of Object.entries(mod)) {
            // makePasswordHint returns display copy, not a schema.
            if (!name.startsWith("make") || name === "makePasswordHint") continue;
            if (typeof value !== "function" || value.length > 0) continue;
            out.push([`${prefix}.${name}`, value as () => ZodType]);
        }
    }
    return out;
}

describe("every form schema, submitted empty", () => {
    const factories = schemaFactories();

    it("covers every schema factory the forms directory exports", () => {
        // A guard on the guard: if the filter above stops matching, this spec
        // would pass by testing nothing.
        expect(factories.length).toBeGreaterThanOrEqual(18);
    });

    for (const [name, factory] of factories) {
        it(`${name} never answers with zod's default message`, () => {
            const submission = parseWithZod(new FormData(), { schema: factory() });
            if (submission.status === "success") return; // nothing required — fine
            const messages = Object.values(submission.error ?? {})
                .flat()
                .filter((msg): msg is string => typeof msg === "string");
            for (const msg of messages) {
                expect(msg.toLowerCase()).not.toContain("invalid input");
                expect(msg.toLowerCase()).not.toContain("expected string");
                expect(msg.trim().length).toBeGreaterThan(0);
            }
        });
    }
});

describe("the required-service-name case that was measured in the browser", () => {
    it("names the field instead of the type system", () => {
        const submission = parseWithZod(new FormData(), { schema: settings.makeCreateServiceSchema() });
        expect(submission.status).toBe("error");
        const nameErrors = submission.status === "error" ? submission.error?.name ?? [] : [];
        expect(nameErrors.length).toBeGreaterThan(0);
        expect(nameErrors[0]).toMatch(/name/i);
    });
});
