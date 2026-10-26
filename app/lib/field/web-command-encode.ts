/**
 * Command encoder for the web data source.
 *
 * Turns a `FieldCommand` into the `intent` and FormData the editor route action
 * reads (`app/routes/inspection-edit/action.server.ts` and the two modules it
 * chains to). Field names and string encodings are the action's, not ours:
 * booleans travel as "true"/"false" (or "1" for `collab`), structured payloads as
 * JSON strings, binaries as `File` instances, because the action tests
 * `formData.get(...) instanceof File`.
 *
 * Optional fields are OMITTED when the command leaves them out, because the
 * action gives "absent" a meaning of its own (`autoSignOnPublish`, `notes`,
 * `sectionId`, `reason`).
 *
 * The `never` default makes the switch exhaustive: a new command or op that is
 * not encoded here fails the type-check.
 */
import type { FieldCommand } from "@core/field-ui/commands";

interface EncodedCommand {
    intent: string;
    form: FormData;
}

/** The action requires a `File`; wrap a bare `Blob` and keep a `File` as it is. */
function asFile(blob: Blob, fallbackName: string): File {
    if (typeof File !== "undefined" && blob instanceof File) return blob;
    return new File([blob], fallbackName, { type: blob.type || "application/octet-stream" });
}

function flag(value: boolean): string {
    return value ? "true" : "false";
}

function build(intent: string, fields: Record<string, string | undefined>, files?: Record<string, File>): EncodedCommand {
    const form = new FormData();
    form.append("intent", intent);
    for (const [name, value] of Object.entries(fields)) {
        if (value !== undefined) form.append(name, value);
    }
    for (const [name, file] of Object.entries(files ?? {})) form.append(name, file);
    return { intent, form };
}

export function encodeCommand(cmd: FieldCommand): EncodedCommand {
    switch (cmd.type) {
        case "complete":
            return build("complete", {});
        case "publish":
            return build("publish", {
                markComplete: cmd.markComplete === undefined ? undefined : flag(cmd.markComplete),
                autoSignOnPublish: cmd.autoSignOnPublish === undefined ? undefined : flag(cmd.autoSignOnPublish),
                summary: cmd.summary,
            });
        case "save-property-facts":
            return build("save-property-facts", { payload: JSON.stringify(cmd.payload) });
        case "autofill-property-facts":
            return build("autofill-property-facts", { addressString: cmd.addressString });
        case "save-settings":
            return build("save-settings", { payload: JSON.stringify(cmd.payload) });
        case "save-pca-narrative":
            return build("save-pca-narrative", { key: cmd.key, value: cmd.value });
        case "sign-inspector":
            return build("sign-inspector", { signatureBase64: cmd.signatureBase64 });
        case "set-cover":
            return build("set-cover", { coverPhotoId: cmd.coverPhotoId });
        case "upload-cover":
            return build("upload-cover", {}, { file: asFile(cmd.file, "cover.jpg") });
        case "crop-cover":
            return build("crop-cover", { sourceKey: cmd.sourceKey, crop: cmd.crop }, { image: asFile(cmd.image, "cover.jpg") });
        case "annotate":
            return build(
                "annotate",
                {
                    itemId: cmd.itemId,
                    photoIndex: String(cmd.photoIndex),
                    nodes: cmd.nodes,
                    sectionId: cmd.sectionId ? cmd.sectionId : undefined,
                },
                { image: asFile(cmd.image, "annotation.png") },
            );
        case "restructure":
            return build("restructure", { snapshot: JSON.stringify(cmd.snapshot), collab: cmd.collab ? "1" : "0" });
        case "save-structure-template":
            return cmd.mode === "new"
                ? build("save-structure-template", { snapshot: JSON.stringify(cmd.snapshot), mode: "new", name: cmd.name })
                : build("save-structure-template", { snapshot: JSON.stringify(cmd.snapshot), mode: "back", templateId: cmd.templateId });
        case "add-statutory-instance":
            return build("add-statutory-instance", {
                groupId: cmd.groupId,
                index: String(cmd.index),
                fields: JSON.stringify(cmd.fields),
            });
        case "save-statutory-details":
            return build("save-statutory-details", { payload: JSON.stringify(cmd.payload) });
        case "set-followup":
            // An empty status is how the action reads "no conclusion", i.e. null.
            return build("set-followup", { itemId: cmd.itemId, status: cmd.status ?? "", notes: cmd.notes });
        case "load-scope":
            return build("load-scope", { scope: cmd.scope });
        case "unit":
            switch (cmd.op) {
                case "create":
                    return build("unit-create", { name: cmd.name });
                case "rename":
                    return build("unit-rename", { unitId: cmd.unitId, name: cmd.name });
                case "delete":
                    return build("unit-delete", { unitId: cmd.unitId });
                case "duplicate":
                    return build("unit-duplicate", { unitId: cmd.unitId });
                case "bulk-create":
                    return build("unit-bulk-create", { payload: JSON.stringify(cmd.payload) });
                case "mode-switch":
                    return build("unit-mode-switch", { mode: cmd.mode });
                default:
                    return assertNever(cmd);
            }
        case "compliance":
            switch (cmd.op) {
                case "signoff":
                    return build("compliance-signoff", {
                        role: cmd.role,
                        ...(cmd.personId ? { personId: cmd.personId } : {}),
                        ...(cmd.name ? { name: cmd.name } : {}),
                        license: cmd.license ?? "",
                        dualRole: flag(cmd.dualRole),
                    });
                case "remove-signoff":
                    return build("compliance-remove-signoff", { role: cmd.role });
                case "doc-review-seed":
                    return build("compliance-doc-review-seed", {});
                case "doc-review":
                    return build("compliance-doc-review", {
                        documentKey: cmd.documentKey,
                        requested: flag(cmd.requested),
                        received: flag(cmd.received),
                        reviewed: flag(cmd.reviewed),
                        na: flag(cmd.na),
                        notes: cmd.notes ?? "",
                    });
                case "psq":
                    return build("compliance-psq", { responses: JSON.stringify(cmd.responses) });
                case "psq-status":
                    return build("compliance-psq-status", { status: cmd.status, reason: cmd.reason });
                default:
                    return assertNever(cmd);
            }
        default:
            return assertNever(cmd);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unencoded field command: ${JSON.stringify(value)}`);
}
