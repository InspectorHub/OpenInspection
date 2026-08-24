/**
 * The rules that decide whether an import run can be started, and which
 * sentence names the reason it cannot.
 *
 * These rules were previously asserted only through the panel that renders
 * them (`app/routes/settings-imports.test.tsx`), which means the ORDER of the
 * ladder — the thing the rules actually are — was tested through a DOM. They
 * get a spec of their own here, because the module is pure and its header says
 * so.
 *
 * Every copy field is a DISTINCT sentinel string. Reusing one would let an
 * assertion pass on the wrong sentence, which is the exact failure this ladder
 * exists to prevent: naming the last outstanding thing instead of the first.
 */
import { describe, expect, it } from 'vitest';

import {
    importStartBlockedReason,
    type ImportEntryPoint,
    type ImportStartCopy,
    type ImportStartDraft,
    type WorkbookStage,
} from './import-entry-points';

const COPY: ImportStartCopy = {
    needsSource: 'NEEDS_SOURCE',
    needsFile: 'NEEDS_FILE',
    readingWorkbook: 'READING_WORKBOOK',
    needsSheet: 'NEEDS_SHEET',
    needsUploadAuthorized: 'NEEDS_UPLOAD_AUTHORIZED',
    needsStaffAccessAuthorized: 'NEEDS_STAFF_ACCESS_AUTHORIZED',
};

/** The contacts entry: one source, so it answers its own vendor question. */
const CONTACTS: ImportEntryPoint = { intent: 'contacts.import', readByPerson: false };
/** The templates entry: three sources, so the vendor is a real question. */
const TEMPLATES: ImportEntryPoint = { intent: 'templates.create', readByPerson: false };
/** The assisted entry: a person opens the file, so it asks a second agreement. */
const ASSISTED: ImportEntryPoint = { intent: 'assisted.full', readByPerson: true };

/** A draft with everything answered EXCEPT the workbook axis under test. Every
 *  workbook case below differs from every other in exactly one field. */
function draftWith(workbook: WorkbookStage): ImportStartDraft {
    return {
        vendor: 'csv_generic',
        hasFile: true,
        workbook,
        uploadAuthorized: true,
        staffAccessAuthorized: false,
    };
}

describe('importStartBlockedReason — the workbook axis', () => {
    it('blocks while the workbook is being read', () => {
        expect(importStartBlockedReason(CONTACTS, draftWith('reading'), COPY))
            .toBe('READING_WORKBOOK');
    });

    it('blocks while a sheet is unchosen', () => {
        expect(importStartBlockedReason(CONTACTS, draftWith('pending'), COPY))
            .toBe('NEEDS_SHEET');
    });

    it('does NOT block when nothing here could read the workbook', () => {
        // 🔴 The escape hatch, and the single most important assertion in this
        // feature. An unreadable workbook is uploaded exactly as it is today
        // and falls to the path a person handles. Blocking here would delete
        // that path from the product without deleting a line of server code.
        expect(importStartBlockedReason(CONTACTS, draftWith('unreadable'), COPY)).toBeNull();
    });

    it('does NOT block for a file that is not a workbook, or for a chosen sheet', () => {
        // Positive controls for the case above, in the direction that matters:
        // the `unreadable` draft is otherwise IDENTICAL to the `pending` one —
        // same vendor, same file, same agreement — so "it does not block"
        // cannot be an artefact of some other field being answered. These two
        // show the same null arriving for the two states where it is
        // unsurprising.
        expect(importStartBlockedReason(CONTACTS, draftWith('not-a-workbook'), COPY)).toBeNull();
        expect(importStartBlockedReason(CONTACTS, draftWith('chosen'), COPY)).toBeNull();
    });
});

describe('importStartBlockedReason — ladder order', () => {
    it('asks for the file before the sheet', () => {
        // A sheet is a question ABOUT a file. Asking it of somebody who has not
        // chosen one names a control that is not on the screen yet.
        const draft: ImportStartDraft = { ...draftWith('pending'), hasFile: false };
        expect(importStartBlockedReason(CONTACTS, draft, COPY)).toBe('NEEDS_FILE');
    });

    it('asks for the sheet before the keep-file agreement', () => {
        const draft: ImportStartDraft = { ...draftWith('pending'), uploadAuthorized: false };
        expect(importStartBlockedReason(CONTACTS, draft, COPY)).toBe('NEEDS_SHEET');
    });

    it('asks for the source before anything else, where there is a choice', () => {
        const draft: ImportStartDraft = { ...draftWith('pending'), vendor: null, hasFile: false };
        expect(importStartBlockedReason(TEMPLATES, draft, COPY)).toBe('NEEDS_SOURCE');
    });

    it('does not ask for a source on an entry that has only one', () => {
        // Positive control for the case above: "source comes first" would also
        // be true of a ladder that asked for it unconditionally, and that would
        // deadlock the two entries whose vendor is settled by the entry itself.
        const draft: ImportStartDraft = { ...draftWith('not-a-workbook'), vendor: null, hasFile: false };
        expect(importStartBlockedReason(CONTACTS, draft, COPY)).toBe('NEEDS_FILE');
    });
});

describe('importStartBlockedReason — the staff agreement', () => {
    it('is asked only where a person opens the file', () => {
        const draft = draftWith('not-a-workbook');
        expect(importStartBlockedReason(ASSISTED, { ...draft, vendor: null }, COPY))
            .toBe('NEEDS_STAFF_ACCESS_AUTHORIZED');
        // Positive control: the same unticked box on an entry nobody opens by
        // hand blocks nothing.
        expect(importStartBlockedReason(CONTACTS, draft, COPY)).toBeNull();
    });

    it('is asked last, after the workbook question', () => {
        const draft: ImportStartDraft = { ...draftWith('reading'), vendor: null };
        expect(importStartBlockedReason(ASSISTED, draft, COPY)).toBe('READING_WORKBOOK');
    });
});
