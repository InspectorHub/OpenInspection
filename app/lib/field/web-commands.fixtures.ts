/** One sample per command key, shared by the encoder, completeness and round-trip specs. */
import type { CommandKey, FieldCommand } from "@core/field-ui/commands";

const snapshot = { schemaVersion: 2 as const, sections: [] };

export const SAMPLES = {
    complete: { type: "complete" },
    publish: { type: "publish", markComplete: true, autoSignOnPublish: false, summary: "Rev 2" },
    "save-property-facts": { type: "save-property-facts", payload: { yearBuilt: 1990 } },
    "autofill-property-facts": { type: "autofill-property-facts", addressString: "12 Main St" },
    "save-settings": { type: "save-settings", payload: { price: "100" } },
    "save-pca-narrative": { type: "save-pca-narrative", key: "scope", value: "text" },
    "sign-inspector": { type: "sign-inspector", signatureBase64: "AAAA" },
    "set-cover": { type: "set-cover", coverPhotoId: "k1" },
    "upload-cover": { type: "upload-cover", file: new Blob(["x"], { type: "image/png" }) },
    "crop-cover": { type: "crop-cover", sourceKey: "k1", crop: "{\"x\":1}", image: new Blob(["y"], { type: "image/jpeg" }) },
    annotate: { type: "annotate", itemId: "i1", photoIndex: 2, nodes: "[]", image: new Blob(["z"], { type: "image/png" }), sectionId: "s1" },
    restructure: { type: "restructure", snapshot, collab: true },
    "save-structure-template": { type: "save-structure-template", mode: "new", snapshot, name: "Mine" },
    "add-statutory-instance": { type: "add-statutory-instance", groupId: "g1", index: 3, fields: { a: "b" } },
    "save-statutory-details": { type: "save-statutory-details", payload: {} },
    "set-followup": { type: "set-followup", itemId: "i1", status: null, notes: "n" },
    "load-scope": { type: "load-scope", scope: "u1" },
    "unit:create": { type: "unit", op: "create", name: "A" },
    "unit:rename": { type: "unit", op: "rename", unitId: "u1", name: "B" },
    "unit:delete": { type: "unit", op: "delete", unitId: "u1" },
    "unit:duplicate": { type: "unit", op: "duplicate", unitId: "u1" },
    "unit:bulk-create": { type: "unit", op: "bulk-create", payload: { mode: "floors_stacks", floors: [1, 2], stacks: 2 } },
    "unit:mode-switch": { type: "unit", op: "mode-switch", mode: "per_unit" },
    "compliance:signoff": { type: "compliance", op: "signoff", role: "pcr_reviewer", personId: "p1", name: "Pat", license: null, dualRole: true },
    "compliance:remove-signoff": { type: "compliance", op: "remove-signoff", role: "field_observer" },
    "compliance:doc-review-seed": { type: "compliance", op: "doc-review-seed" },
    "compliance:doc-review": { type: "compliance", op: "doc-review", documentKey: "d1", requested: true, received: false, reviewed: true, na: false, notes: null },
    "compliance:psq": { type: "compliance", op: "psq", responses: { q1: "yes" } },
    "compliance:psq-status": { type: "compliance", op: "psq-status", status: "declined", reason: "no time" },
} satisfies Record<CommandKey<FieldCommand>, FieldCommand>;
