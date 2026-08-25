/**
 * The per-entity writers the apply loop dispatches to, and the vocabulary it
 * reports their results in.
 *
 * Split out of `apply.service.ts` when that file crossed the 400-line gate. The
 * seam is not arbitrary: everything here answers "given one staged entry, what
 * does writing it produce", and knows nothing about batches, claims, seats or
 * status transitions; the service next door knows nothing about how any one
 * kind of entry reaches a real table. The member writer already lived on its
 * own for the same reason and is left where it is — see the note on its file
 * for what its separation buys.
 *
 * Neither writer decides whether the entry SHOULD be written. `describeRowProblem`
 * has already refused anything a person still has to correct, which is why both
 * functions may narrow a value and treat a failure to narrow as a bug rather
 * than as a case.
 */
import { and, eq } from 'drizzle-orm';
import type { migrationBatches, migrationRows } from '../../lib/db/schema';
import {
    contacts,
    templates,
    type MigrationRowResolution,
} from '../../lib/db/schema';
import { TemplateService } from '../template.service';
import { captureContactPriorState } from './contact-snapshot';
import { asBundleContactType, type BundleContact, type BundleTemplate } from '../../lib/migration-intake/bundle';
import type { IntakeDb } from '../../lib/migration-intake/conflicts';

type StagedRowRecord = typeof migrationRows.$inferSelect;
type StagedBatchRecord = typeof migrationBatches.$inferSelect;

/**
 * What one row's write produced.
 *
 * `skipped` and `failed` are separate answers and are never merged: a skip is a
 * decision the operator made, a failure is something that went wrong, and a
 * report that calls one the other is telling the operator to go looking for a
 * bug that is not there — or not to look for one that is.
 */
export type RowOutcome =
    | { kind: 'applied'; createdId: string; priorState: string | null }
    | { kind: 'skipped'; reason: string }
    | { kind: 'failed'; reason: string };

export async function applyTemplateRow(
    db: IntakeDb,
    d1: D1Database,
    tenantId: string,
    batch: StagedBatchRecord,
    row: StagedRowRecord,
    resolution: MigrationRowResolution,
): Promise<RowOutcome> {
    const payload = JSON.parse(row.payload) as BundleTemplate;
    const service = new TemplateService(d1);

    if (batch.intent === 'templates.overwrite') {
        const targetId = row.conflictWith ?? batch.targetId;
        if (!targetId) return { kind: 'failed', reason: 'This overwrite has no target template.' };
        if (resolution === 'skip') {
            return { kind: 'skipped', reason: 'The existing template was kept, so this entry was not imported.' };
        }
        // Read what is live HERE, not at stage time: staging can sit for a
        // while, and a snapshot taken before an unrelated edit would restore
        // content the operator never had.
        const live = await db.select({ schema: templates.schema }).from(templates)
            .where(and(eq(templates.id, targetId), eq(templates.tenantId, tenantId)))
            .get();
        if (!live) return { kind: 'failed', reason: 'The template being replaced no longer exists.' };
        // The column is json-mode, so a row written through this service reads
        // back as the string it was handed while one written as an object reads
        // back as an object. Both are stored as the text the undo will hand
        // straight back.
        const priorState = typeof live.schema === 'string' ? live.schema : JSON.stringify(live.schema);

        // The NAME is left alone deliberately. The operator was standing on
        // this template when they started, so it is this template they meant to
        // refill — renaming it to whatever the export happened to be called
        // changes the thing they were pointing at. It also keeps the snapshot
        // above complete: the document is the only field this path touches, so
        // the document is the only field the undo has to restore.
        await service.updateTemplate(
            targetId,
            tenantId,
            undefined,
            payload.schema as unknown as Record<string, unknown>,
        );
        return { kind: 'applied', createdId: targetId, priorState };
    }

    const created = await service.createTemplate(
        tenantId,
        payload.name,
        payload.schema as unknown as Record<string, unknown>,
    );
    return { kind: 'applied', createdId: created.id, priorState: null };
}

export async function applyContactRow(
    db: IntakeDb,
    tenantId: string,
    row: StagedRowRecord,
    resolution: MigrationRowResolution,
): Promise<RowOutcome> {
    const payload = JSON.parse(row.payload) as BundleContact;
    // The format carries what the file said; the COLUMN takes one of ours. The
    // caller has already refused anything the describer objects to, so this
    // cannot be null in practice — it is the compiler's proof that the
    // narrowing happened, and a last refusal if a future caller skips it.
    const type = asBundleContactType(payload.type);
    if (!type) return { kind: 'failed', reason: `"${payload.type}" is not a contact type.` };
    // An address the file left blank is stored as ABSENT, never as an empty
    // string: the active-contact unique index is on the address, so two blank
    // ones would collide with each other.
    const email = payload.email?.trim() || null;

    if (row.conflictWith) {
        if (resolution === 'skip') {
            return {
                kind: 'skipped',
                reason: 'A contact with this email address already exists and was left as it was.',
            };
        }
        const live = await db.select().from(contacts)
            .where(and(eq(contacts.id, row.conflictWith), eq(contacts.tenantId, tenantId)))
            .get();
        if (!live) return { kind: 'failed', reason: 'The contact being replaced no longer exists.' };
        // The snapshot an undo restores. Captured through the shared pair rather
        // than assembled here, so the shape this path writes and the shape the
        // undo path reads cannot drift: a field missing from the snapshot is a
        // field the undo silently fails to bring back.
        const priorState = captureContactPriorState(live);

        // EMAIL IS NOT WRITTEN, and its absence here is the point rather than an
        // omission: the address is what identified this row as the one to
        // replace, so rewriting it would make the row a different person while
        // claiming to have updated the same one. Every other field takes what
        // the file said, including the empty ones — a row that blends the file
        // with what was already there is a row no source can account for.
        await db.update(contacts).set({
            name: payload.name,
            phone: payload.phone ?? null,
            agency: payload.agency ?? null,
            notes: payload.notes ?? null,
            type,
        }).where(and(eq(contacts.id, live.id), eq(contacts.tenantId, tenantId)));

        return { kind: 'applied', createdId: live.id, priorState };
    }

    const id = crypto.randomUUID();
    await db.insert(contacts).values({
        id,
        tenantId,
        type,
        name: payload.name,
        email,
        phone: payload.phone ?? null,
        agency: payload.agency ?? null,
        notes: payload.notes ?? null,
        createdAt: new Date(),
    });
    return { kind: 'applied', createdId: id, priorState: null };
}
