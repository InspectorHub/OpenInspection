/**
 * Putting an authority's own PDF into storage, once somebody has proved it is
 * that PDF.
 *
 * ── WHY THIS IS A MANUAL UPLOAD AND NOT A FETCH ─────────────────────────────
 * `StatutoryFormVersion.sourceUrl` says of itself: "provenance for a human,
 * never fetched at render time". Turning it into a runtime fetch would overturn
 * that decision, and it would not work anyway. Two authorities were measured
 * (2026-08-28) serving a SUPERSEDED revision at their most guessable address,
 * so a fetch would come back with bytes whose sha256 is not the recorded one --
 * and the deployment would fail for a reason its operator has no way to fix,
 * because the fault is on the far end of a URL nobody here controls.
 *
 * A person, on the other hand, CAN fix it: they open the PDF and read the
 * revision printed on the page. That is the only reliable way to tell two
 * revisions of the same form apart, and it is why the upload is a step a person
 * takes rather than something done on their behalf.
 *
 * ── WHY THE HASH IS CHECKED HERE AND NOT TRUSTED LATER ──────────────────────
 * A field map is authored against one revision's exact bytes and is bound to
 * their sha256, because these forms' field names are typed by hand and a
 * corrected typo silently moves content into a different box. Bytes that are
 * not the recorded ones are therefore a document nothing in this subsystem can
 * render correctly -- and the render would not look broken, it would look
 * official. Refusing at the door is the only place the difference is cheap.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT CHECK ───────────────────────────────────
 * Whether the revision is withdrawn. A withdrawal stops NEW production; the
 * documents already produced from that revision are in other people's hands and
 * re-issuing one reads these exact bytes. Refusing the upload would make the
 * withdrawal destroy the very thing it was careful to leave alone.
 */
import { Errors } from '../../lib/errors';
import { r2Keys } from '../../lib/r2-keys';
import { sha256Hex } from '../../lib/sha256';
import type { StatutoryFormVersion } from '../../lib/statutory/form-registry';

/**
 * What an operator is told when the bytes are not the ones this revision names.
 *
 * BOTH values, and the instruction that resolves it. The operator is standing
 * in a downloads folder holding one of several PDFs that all look the same and
 * are frequently all called `form.pdf`; "Upload failed" tells them to try the
 * next one at random. What tells the files apart is the revision printed inside
 * the document, so the message says that in as many words -- and warns that the
 * address it came from is not evidence, because an authority serving a
 * superseded revision at its most obvious URL is the measured normal case here
 * rather than an exotic one.
 */
function sourceHashMismatchMessage(
    version: StatutoryFormVersion,
    computed: string,
): string {
    return `This file's sha256 is ${computed}, and revision ${version.version} of `
        + `${version.formId} records ${version.sourceHash}. They are two different `
        + 'documents. The revision printed on the document itself is what tells them '
        + 'apart -- the filename does not, and neither does the address it was '
        + 'downloaded from: an authority may serve a superseded revision at its most '
        + `obvious URL. Open the PDF, confirm the page prints revision `
        + `${version.version}, and upload that file. This revision is published at `
        + `${version.sourceUrl}.`;
}

export interface StatutoryFormSourceUpload {
    bucket: R2Bucket;
    /** The compiled-in catalogue. Passed in so this module holds no import of it. */
    versions: readonly StatutoryFormVersion[];
    formId: string;
    /** The authority's own revision label, verbatim -- `7-6`, `Rev. 04/26`. */
    revision: string;
    bytes: Uint8Array;
}

/**
 * Verify the bytes against the revision that names them, then store them.
 *
 * Throws rather than returning a result union: every caller's only correct
 * response to a mismatch is to refuse the request with this message, and a
 * returned error is one a caller can forget to read.
 */
export async function storeStatutoryFormSource(
    input: StatutoryFormSourceUpload,
): Promise<{ key: string; formId: string; revision: string; sha256: string }> {
    const version = input.versions.find(
        (v) => v.formId === input.formId && v.version === input.revision,
    );
    if (version === undefined) {
        // Not a 400. Bytes for a revision this software does not publish could
        // never be verified against anything, so there is nothing here to fix by
        // uploading a different file.
        throw Errors.NotFound(
            `This software publishes no revision ${input.revision} of ${input.formId}, `
            + 'so there is no recorded sha256 to check an upload against.',
        );
    }

    const computed = await sha256Hex(input.bytes);
    if (computed !== version.sourceHash) {
        throw Errors.BadRequest(sourceHashMismatchMessage(version, computed));
    }

    // The key is shared across the whole deployment on purpose -- one state
    // document, one copy, see the exception documented in r2-keys.ts. Writing it
    // is idempotent by construction: the hash check above admits exactly one
    // sequence of bytes, so a re-upload can only ever overwrite them with
    // themselves.
    const key = r2Keys.statutoryFormSource(version.formId, version.version);
    await input.bucket.put(key, input.bytes as unknown as ArrayBuffer, {
        httpMetadata: { contentType: 'application/pdf' },
    });

    return { key, formId: version.formId, revision: version.version, sha256: computed };
}

/**
 * One published revision, and whether this deployment is actually holding the
 * bytes it needs to render it.
 *
 * The catalogue fields are carried alongside on purpose. What the operator has
 * to do next is decided by the pair -- an absent revision that is withdrawn is
 * not worth chasing a file for, and an absent revision that is mandatory today
 * is the one that stops work -- and a reader who has to join two screens to see
 * that pair will read one of them and act.
 */
export interface StatutoryFormSourcePresence {
    formId: string;
    /** The form's own published name, as the authority writes it. */
    formTitle: string;
    /** The authority's own revision label, verbatim. */
    revision: string;
    /** The sha256 an upload is checked against, lowercase hex. */
    sourceHash: string;
    /** Where the authority publishes it. Provenance for a human. */
    sourceUrl: string;
    effectiveFrom: number;
    mandatoryFrom: number | null;
    effectiveUntil: number | null;
    withdrawn: { at: number; reason: string } | null;
    /** Whether the verified bytes are in this deployment's object storage. */
    present: boolean;
    /** Size of the stored object, or null when nothing is stored. */
    sizeBytes: number | null;
    /** When the stored bytes were written, epoch ms, or null when absent. */
    uploadedAt: number | null;
}

/**
 * What this deployment holds for every revision it publishes.
 *
 * ── WHY `storageBound` IS REPORTED SEPARATELY FROM `present` ────────────────
 * A deployment with no bucket bound and a deployment whose bucket is empty both
 * produce `present: false` for every row, and they are not the same problem:
 * the second is fixed by uploading a file, the first cannot be fixed by
 * uploading anything at all. Collapsing them would put an operator in front of
 * an upload control that can never succeed, which is the same class of fault --
 * a door onto a wall -- that this whole surface exists to remove. So the flag
 * travels beside the rows, and a caller that ignores it is at worst pessimistic
 * rather than wrong.
 *
 * Presence is a `head`, never a `get`: the answer is one bit plus the object's
 * own metadata, and reading a multi-megabyte PDF to learn it would put the
 * whole catalogue's bytes through a worker on every page load.
 */
export async function listStatutoryFormSources(input: {
    bucket: R2Bucket | undefined;
    versions: readonly StatutoryFormVersion[];
}): Promise<{ storageBound: boolean; revisions: StatutoryFormSourcePresence[] }> {
    const rows = await Promise.all(input.versions.map(async (version) => {
        const head = input.bucket === undefined
            ? null
            : await input.bucket.head(r2Keys.statutoryFormSource(version.formId, version.version));
        return {
            formId: version.formId,
            // The form's own name, carried because `formId` is a DATABASE KEY.
            // The registry says so where it is declared: an id is lowercased,
            // underscored and ours, and it is neither what the authority calls
            // the document nor what a person can check against their site. This
            // list is read while matching a downloaded PDF to a row, which is
            // exactly the job an id cannot do.
            formTitle: version.formTitle,
            revision: version.version,
            sourceHash: version.sourceHash,
            sourceUrl: version.sourceUrl,
            effectiveFrom: version.effectiveFrom,
            mandatoryFrom: version.mandatoryFrom,
            effectiveUntil: version.effectiveUntil,
            withdrawn: version.withdrawn === null
                ? null
                : { at: version.withdrawn.at, reason: version.withdrawn.reason },
            present: head !== null,
            sizeBytes: head?.size ?? null,
            // `uploaded` is a Date on R2's own object. Epoch ms crosses the
            // wire, because the surface that renders it formats in the viewer's
            // own locale and timezone rather than in the worker's.
            uploadedAt: head?.uploaded instanceof Date ? head.uploaded.getTime() : null,
        };
    }));
    return { storageBound: input.bucket !== undefined, revisions: rows };
}
