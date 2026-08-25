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
    needsPdfFile: 'NEEDS_PDF_FILE',
    readingWorkbook: 'READING_WORKBOOK',
    needsSheet: 'NEEDS_SHEET',
    needsStatement: 'NEEDS_STATEMENT',
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

describe('importStartBlockedReason — the statement axis (PDF inference)', () => {
    /** A draft on the templates entry with a source nothing here can read, so
     *  the PDF route applies. Everything else is answered, so each case below
     *  differs from the others in exactly one field. */
    function pdfDraft(over: Partial<ImportStartDraft> = {}): ImportStartDraft {
        return {
            vendor: 'homegauge',
            hasFile: true,
            workbook: 'not-a-workbook',
            statementAccepted: true,
            uploadAuthorized: true,
            staffAccessAuthorized: false,
            ...over,
        };
    }

    it('blocks on the statement BEFORE it blocks on the file', () => {
        // 🔴 The whole reason this arm exists, and the reason its POSITION is
        // the design rather than an implementation detail. The PDF dropzone is
        // `disabled={!statementAccepted}`, so an operator who has not ticked the
        // statement CANNOT choose a file. If this arm sat after `needsFile` —
        // where all six existing arms sit — the button would say "choose the
        // file you exported" beside a picker that refuses to open, and the
        // operator would have no way to learn what is actually wanted.
        expect(
            importStartBlockedReason(TEMPLATES, pdfDraft({ statementAccepted: false, hasFile: false }), COPY),
        ).toBe('NEEDS_STATEMENT');
    });

    it('stops blocking once the statement is accepted', () => {
        // Positive control for the case above, differing in that one field.
        // Without it, an arm that returned NEEDS_STATEMENT unconditionally
        // would pass the assertion above and never let anybody import.
        // 🔴 And it names the PRINTED file, not an exported one. The screen's
        // own guidance has just told the operator to print a PDF; a sentence
        // asking for "the file you exported" is wrong about what they did, and
        // being told to produce something they were never asked for is how a
        // person concludes they are on the wrong screen.
        expect(importStartBlockedReason(TEMPLATES, pdfDraft({ hasFile: false }), COPY)).toBe('NEEDS_PDF_FILE');
    });

    it('does not ask for a statement on a source this deployment can read', () => {
        // The arm is keyed on the SOURCE, not on the entry: spectora is read
        // here, so its upload is unchanged and never grows a second gate.
        expect(
            importStartBlockedReason(
                TEMPLATES,
                pdfDraft({ vendor: 'spectora', statementAccepted: false }),
                COPY,
            ),
        ).toBeNull();
    });

    it('does not ask for a statement before a source has been named', () => {
        // A null vendor is not a declaration that anything is unreadable, and
        // the ladder must still ask the question it already asks first.
        expect(
            importStartBlockedReason(TEMPLATES, pdfDraft({ vendor: null, statementAccepted: false }), COPY),
        ).toBe('NEEDS_SOURCE');
    });

    it('does not ask for a statement on the assisted entry, which offers no source', () => {
        // `assisted.full` exists for a file whose owner could not name the
        // product. There is no source to be unreadable, so the PDF route does
        // not apply and the person-reads-it agreement is what is asked instead.
        expect(
            importStartBlockedReason(
                ASSISTED,
                pdfDraft({ vendor: null, statementAccepted: false, staffAccessAuthorized: false }),
                COPY,
            ),
        ).toBe('NEEDS_STAFF_ACCESS_AUTHORIZED');
    });
});
