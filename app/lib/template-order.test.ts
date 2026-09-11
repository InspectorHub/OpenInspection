import { describe, it, expect } from "vitest";
import { operatorStateFromRegion, orderTemplatesForPicker } from "./template-order";

/**
 * What this pins down is the FIRST row of the template picker, because that row
 * is the one Enter selects.
 *
 * The list arrives from `GET /api/inspections/templates` in `created_at DESC`
 * order — newest first, which is nobody's preference about templates. A
 * workspace that installed a state's statutory form most recently therefore led
 * with that form, and an inspector who does not practise in that state was
 * offered it first.
 */

/** Newest-first, exactly as the API hands it over: the statutory form leads. */
const AS_THE_API_ORDERS_THEM = [
    { id: "trec", name: "Texas TREC REI 7-6", jurisdiction: "TX" },
    { id: "radon", name: "Radon Measurement Report", jurisdiction: null },
    { id: "4point", name: "Florida Four-Point", jurisdiction: "FL" },
    { id: "standard", name: "Standard Residential Inspection", jurisdiction: null },
];

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

describe("operatorStateFromRegion", () => {
    it("reads the state out of a US-{ST} region", () => {
        expect(operatorStateFromRegion("US-TX")).toBe("TX");
        expect(operatorStateFromRegion("us-tx")).toBe("TX");
    });

    it("answers null for a country-only region, because a country is not a state", () => {
        expect(operatorStateFromRegion("US")).toBeNull();
    });

    it("answers null when the workspace has said nothing", () => {
        expect(operatorStateFromRegion(null)).toBeNull();
        expect(operatorStateFromRegion(undefined)).toBeNull();
        expect(operatorStateFromRegion("   ")).toBeNull();
    });
});

describe("orderTemplatesForPicker", () => {
    it("leads with a general template when the workspace's state is unknown", () => {
        const ordered = orderTemplatesForPicker(AS_THE_API_ORDERS_THEM, null);
        expect(ids(ordered)[0]).toBe("radon");
        // Both general templates come before EITHER statutory form — not just
        // one general row hoisted above the Texas one.
        expect(ids(ordered)).toEqual(["radon", "standard", "trec", "4point"]);
    });

    it("leads with the statutory form of the state the workspace works in", () => {
        expect(ids(orderTemplatesForPicker(AS_THE_API_ORDERS_THEM, "US-TX")))
            .toEqual(["trec", "radon", "standard", "4point"]);
        expect(ids(orderTemplatesForPicker(AS_THE_API_ORDERS_THEM, "US-FL")))
            .toEqual(["4point", "radon", "standard", "trec"]);
    });

    it("sinks another state's form below the general ones", () => {
        const ordered = ids(orderTemplatesForPicker(AS_THE_API_ORDERS_THEM, "US-OH"));
        expect(ordered[0]).toBe("radon");
        expect(ordered.indexOf("standard")).toBeLessThan(ordered.indexOf("trec"));
    });

    it("matches a jurisdiction written with its country prefix", () => {
        const rows = [{ id: "g", name: "General", jurisdiction: null }, { id: "tx", name: "TX form", jurisdiction: "US-TX" }];
        expect(ids(orderTemplatesForPicker(rows, "US-TX"))).toEqual(["tx", "g"]);
    });

    it("never offers a retired template first, even the matching one", () => {
        const rows = [
            { id: "trec-old", name: "Texas TREC REI 7-5", jurisdiction: "TX", retiredAt: 1_700_000_000_000 },
            { id: "trec", name: "Texas TREC REI 7-6", jurisdiction: "TX" },
            { id: "standard", name: "Standard Residential Inspection", jurisdiction: null },
        ];
        expect(ids(orderTemplatesForPicker(rows, "US-TX"))).toEqual(["trec", "standard", "trec-old"]);
        expect(ids(orderTemplatesForPicker(rows, null))).toEqual(["standard", "trec", "trec-old"]);
    });

    it("keeps the API's own order inside each group, so the result is one re-bucketing and not a re-sort", () => {
        const rows = [
            { id: "a", name: "A", jurisdiction: null },
            { id: "b", name: "B", jurisdiction: null },
            { id: "c", name: "C", jurisdiction: null },
        ];
        expect(ids(orderTemplatesForPicker(rows, "US-TX"))).toEqual(["a", "b", "c"]);
    });

    it("does not mutate the array it was given", () => {
        const rows = [...AS_THE_API_ORDERS_THEM];
        orderTemplatesForPicker(rows, "US-TX");
        expect(ids(rows)).toEqual(["trec", "radon", "4point", "standard"]);
    });

    it("treats a template with no jurisdiction field at all as general", () => {
        const rows = [{ id: "tx", name: "TX", jurisdiction: "TX" }, { id: "plain", name: "Plain" }];
        expect(ids(orderTemplatesForPicker(rows, null))).toEqual(["plain", "tx"]);
    });
});
