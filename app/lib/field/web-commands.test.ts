// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { FieldCommand } from "@core/field-ui/commands";
import { encodeCommand } from "./web-commands";
import { SAMPLES } from "./web-commands.fixtures";

const ACTION_DIR = resolve(__dirname, "../../routes/inspection-edit");
const ACTION_FILES = ["action.server.ts", "action-statutory.server.ts", "action-followup.server.ts"];

/** Every `intent === "x"` / `intent !== "x"` literal the three action modules dispatch on. */
function scanIntents(): Set<string> {
    const found = new Set<string>();
    for (const file of ACTION_FILES) {
        const src = readFileSync(resolve(ACTION_DIR, file), "utf8");
        for (const m of src.matchAll(/\bintent\s*(?:===|!==)\s*"([^"]+)"/g)) found.add(m[1]!);
    }
    return found;
}

/** A form as comparable data: File values show as `File:<name>:<type>`. */
function snapshot(form: FormData): Array<[string, string]> {
    return [...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `File:${v.name}:${v.type}`]);
}

describe("encoder completeness against the action", () => {
    it("encodes exactly the intents the action dispatches on, plus upload-photo", () => {
        const scanned = scanIntents();
        const encoded = new Set(Object.values(SAMPLES).map((cmd) => encodeCommand(cmd as FieldCommand).intent));
        // Print both numbers: an empty scan must not read as a pass.
        console.info(`action intents scanned: ${scanned.size}; encoded intents: ${encoded.size} (+ upload-photo)`);
        expect(scanned.size).toBe(30);
        expect(encoded.size).toBe(29);
        expect([...scanned].sort()).toEqual([...encoded, "upload-photo"].sort());
    });
});

describe("encodeCommand golden FormData", () => {
    const enc = (cmd: FieldCommand) => snapshot(encodeCommand(cmd).form);
    const SNAP = "{\"schemaVersion\":2,\"sections\":[]}";

    it("encodes each sample to the action field names and strings", () => {
        const golden: Record<keyof typeof SAMPLES, Array<[string, string]>> = {
            complete: [["intent", "complete"]],
            publish: [["intent", "publish"], ["markComplete", "true"], ["autoSignOnPublish", "false"], ["summary", "Rev 2"]],
            "save-property-facts": [["intent", "save-property-facts"], ["payload", "{\"yearBuilt\":1990}"]],
            "autofill-property-facts": [["intent", "autofill-property-facts"], ["addressString", "12 Main St"]],
            "save-settings": [["intent", "save-settings"], ["payload", "{\"price\":\"100\"}"]],
            "save-pca-narrative": [["intent", "save-pca-narrative"], ["key", "scope"], ["value", "text"]],
            "sign-inspector": [["intent", "sign-inspector"], ["signatureBase64", "AAAA"]],
            "set-cover": [["intent", "set-cover"], ["coverPhotoId", "k1"]],
            "upload-cover": [["intent", "upload-cover"], ["file", "File:cover.jpg:image/png"]],
            "crop-cover": [["intent", "crop-cover"], ["sourceKey", "k1"], ["crop", "{\"x\":1}"], ["image", "File:cover.jpg:image/jpeg"]],
            annotate: [["intent", "annotate"], ["itemId", "i1"], ["photoIndex", "2"], ["nodes", "[]"], ["sectionId", "s1"], ["image", "File:annotation.png:image/png"]],
            restructure: [["intent", "restructure"], ["snapshot", SNAP], ["collab", "1"]],
            "save-structure-template": [["intent", "save-structure-template"], ["snapshot", SNAP], ["mode", "new"], ["name", "Mine"]],
            "add-statutory-instance": [["intent", "add-statutory-instance"], ["groupId", "g1"], ["index", "3"], ["fields", "{\"a\":\"b\"}"]],
            "save-statutory-details": [["intent", "save-statutory-details"], ["payload", "{}"]],
            "set-followup": [["intent", "set-followup"], ["itemId", "i1"], ["status", ""], ["notes", "n"]],
            "load-scope": [["intent", "load-scope"], ["scope", "u1"]],
            "unit:create": [["intent", "unit-create"], ["name", "A"]],
            "unit:rename": [["intent", "unit-rename"], ["unitId", "u1"], ["name", "B"]],
            "unit:delete": [["intent", "unit-delete"], ["unitId", "u1"]],
            "unit:duplicate": [["intent", "unit-duplicate"], ["unitId", "u1"]],
            "unit:bulk-create": [["intent", "unit-bulk-create"], ["payload", "{\"mode\":\"floors_stacks\",\"floors\":[1,2],\"stacks\":2}"]],
            "unit:mode-switch": [["intent", "unit-mode-switch"], ["mode", "per_unit"]],
            "compliance:signoff": [["intent", "compliance-signoff"], ["role", "pcr_reviewer"], ["personId", "p1"], ["name", "Pat"], ["license", ""], ["dualRole", "true"]],
            "compliance:remove-signoff": [["intent", "compliance-remove-signoff"], ["role", "field_observer"]],
            "compliance:doc-review-seed": [["intent", "compliance-doc-review-seed"]],
            "compliance:doc-review": [["intent", "compliance-doc-review"], ["documentKey", "d1"], ["requested", "true"], ["received", "false"], ["reviewed", "true"], ["na", "false"], ["notes", ""]],
            "compliance:psq": [["intent", "compliance-psq"], ["responses", "{\"q1\":\"yes\"}"]],
            "compliance:psq-status": [["intent", "compliance-psq-status"], ["status", "declined"], ["reason", "no time"]],
        };
        for (const key of Object.keys(SAMPLES) as Array<keyof typeof SAMPLES>) {
            expect(enc(SAMPLES[key] as FieldCommand), key).toEqual(golden[key]);
        }
    });

    it("binaries are File instances", () => {
        expect(encodeCommand(SAMPLES["upload-cover"]).form.get("file")).toBeInstanceOf(File);
        expect(encodeCommand(SAMPLES["crop-cover"]).form.get("image")).toBeInstanceOf(File);
        expect(encodeCommand(SAMPLES.annotate).form.get("image")).toBeInstanceOf(File);
    });

    it("keeps a File name", () => {
        const file = new File(["x"], "mine.png", { type: "image/png" });
        expect(enc({ type: "upload-cover", file })).toContainEqual(["file", "File:mine.png:image/png"]);
    });

    it("omits optional fields the action reads as absent", () => {
        expect(enc({ type: "publish" })).toEqual([["intent", "publish"]]);
        expect(enc({ type: "publish", markComplete: false })).toEqual([["intent", "publish"], ["markComplete", "false"]]);
        expect(enc({ type: "set-followup", itemId: "i", status: "ok" })).toEqual([["intent", "set-followup"], ["itemId", "i"], ["status", "ok"]]);
        expect(enc({ type: "compliance", op: "psq-status", status: "sent" })).toEqual([["intent", "compliance-psq-status"], ["status", "sent"]]);
        expect(encodeCommand({ ...SAMPLES.annotate, sectionId: "" }).form.has("sectionId")).toBe(false);
        expect(encodeCommand({ ...SAMPLES.annotate, sectionId: undefined }).form.has("sectionId")).toBe(false);
    });

    it("encodes the back mode of save-structure-template with the template id and no name", () => {
        const snap = { schemaVersion: 2 as const, sections: [] };
        expect(enc({ type: "save-structure-template", mode: "back", snapshot: snap, templateId: "t1" })).toEqual([
            ["intent", "save-structure-template"],
            ["snapshot", SNAP],
            ["mode", "back"],
            ["templateId", "t1"],
        ]);
        expect(enc({ type: "save-structure-template", mode: "new", snapshot: snap }).some(([k]) => k === "name")).toBe(false);
    });

    it("negative control: a wrong field name is detected by the golden comparison", () => {
        const wrong = enc(SAMPLES["save-pca-narrative"]).map(([k, v]): [string, string] => [k === "key" ? "name" : k, v]);
        expect(wrong).not.toEqual([["intent", "save-pca-narrative"], ["key", "scope"], ["value", "text"]]);
    });
});
