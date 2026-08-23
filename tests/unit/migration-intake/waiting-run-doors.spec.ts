/**
 * How many ways there are into a waiting run, and whether each one asks the
 * owner question.
 *
 * A "waiting run" is an import batch parked in `needs_assistance`: its file is
 * kept so that a person can open it and convert it by hand. Opening one is the
 * decision to put a file containing a third party's personal data in front of
 * somebody outside the company, and that decision is an owner's.
 *
 * ── Why a structural spec exists at all ─────────────────────────────────────
 * The behaviour is asserted next door in `routes-create.spec.ts`, once per
 * door, each with its own positive control. That spec proves the rule holds on
 * the two doors that exist. It cannot prove anything about a third.
 *
 * And a third is exactly how this broke before. The rule was written twice —
 * once on the intent that names assistance outright, once nowhere — so the
 * unreadable-file fallback reached the same decision through a gate that had
 * never been told about it, and a manager could open a waiting run. Nothing
 * failed, because nothing was watching the shape.
 *
 * ── The two shapes a third door could take ──────────────────────────────────
 * They need different rules, and only the second one is obvious in hindsight:
 *   1. another CALL to the service method that opens a run — pinned by the
 *      call-site rule;
 *   2. another WRITE that parks a row in the waiting status directly, in a
 *      method of its own, never touching the first one — pinned by the
 *      status-write rule. This is the likelier of the two, and the call-site
 *      rule alone would not see it.
 *
 * What is pinned is not "a second one is wrong" — one may well be right some
 * day. It is that a second cannot be added SILENTLY: whoever adds it has to
 * come here, read why the first is guarded, and say where the owner check goes
 * on theirs.
 *
 * ── The trap this spec is written around ────────────────────────────────────
 * Source-scanning checks in this repo have repeatedly been fooled by PROSE. A
 * comment that names a function — and the comments in this module name these
 * functions constantly, because explaining a rule requires stating it — reads
 * to a plain `grep` exactly like a call. So comments are stripped before
 * anything is counted, and every matcher below is exercised by controls in
 * BOTH directions: it must not count a mention, and it must not miss a real
 * call. A stripper that ate too much would turn every rule here green.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SERVER_DIR = resolve(__dirname, '../../../server');

/** Where the one guarded door lives, as a repo-relative path. */
const THE_DOOR = 'server/api/migration-intake.ts';
/** The only place a row is allowed to be parked in the waiting status. */
const THE_WRITER = 'server/services/migration-intake/stage.service.ts';

/**
 * Source with its comments removed, so a rule stated in prose is not counted
 * as a rule broken in code.
 *
 * Line comments are only stripped where the `//` is not inside a string
 * literal — judged by the quote marks before it on that line. A blunter
 * stripper would swallow the remainder of any line holding a URL, and a call
 * sitting after one on the same line would vanish from the scan. That is a
 * FALSE GREEN, which is the failure mode this whole file exists to prevent, so
 * it is controlled for rather than assumed away.
 */
function stripComments(source: string): string {
    const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
    return withoutBlocks
        .split('\n')
        .map((line) => {
            const at = line.indexOf('//');
            if (at === -1) return line;
            const before = line.slice(0, at);
            const quotes = (before.match(/['"`]/g) ?? []).length;
            // An odd count means the `//` is inside an unclosed string.
            return quotes % 2 === 1 ? line : before;
        })
        .join('\n');
}

/** Every `.ts` file under `server/`, as repo-relative paths, source unmodified. */
function serverFiles(dir = SERVER_DIR, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const abs = join(dir, entry);
        if (statSync(abs).isDirectory()) {
            serverFiles(abs, acc);
        } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
            acc.push(abs);
        }
    }
    return acc;
}

interface SourceFile {
    path: string;
    /** RAW source. Every matcher strips it itself, so the controls below
     *  exercise the stripper rather than bypassing it. */
    source: string;
}

const scanned: SourceFile[] = serverFiles().map((abs) => ({
    path: `server/${abs.slice(SERVER_DIR.length + 1)}`.replace(/\\/g, '/'),
    source: readFileSync(abs, 'utf8'),
}));

/**
 * Files that CALL the batch-opening service method, one entry per call.
 *
 * The declaration reads `async createAssistanceBatch(` and is not a call.
 */
function assistanceBatchCallSites(files: SourceFile[]): string[] {
    const out: string[] = [];
    for (const file of files) {
        const code = stripComments(file.source)
            .replace(/async\s+createAssistanceBatch\s*\(/g, ' ');
        const hits = code.match(/createAssistanceBatch\s*\(/g) ?? [];
        for (let i = 0; i < hits.length; i++) out.push(file.path);
    }
    return out;
}

/** A drizzle mutation of the batches table, sliced from its verb to its `;`. */
interface BatchMutation {
    path: string;
    statement: string;
}

/**
 * Every insert/update against `migrationBatches`, as the text of the statement.
 *
 * Sliced to the statement's own terminator so that the status named in a
 * RESPONSE BODY a few lines away is not read as a column being written. That
 * distinction is the whole difficulty here: `status:
 * MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE` appears in the guarded route as the
 * value it reports to the caller, and reporting a status is not opening a run.
 */
function batchMutations(files: SourceFile[]): BatchMutation[] {
    const out: BatchMutation[] = [];
    const VERB = /\b(?:insert|update)\s*\(\s*migrationBatches\s*\)/g;
    for (const file of files) {
        const code = stripComments(file.source);
        let match: RegExpExecArray | null;
        VERB.lastIndex = 0;
        while ((match = VERB.exec(code)) !== null) {
            const end = code.indexOf(';', match.index);
            out.push({
                path: file.path,
                statement: code.slice(match.index, end === -1 ? code.length : end),
            });
        }
    }
    return out;
}

/** Files whose mutations park a row in the waiting status. */
function waitingStatusWrites(files: SourceFile[]): string[] {
    return batchMutations(files)
        .filter((m) => /status:\s*MIGRATION_BATCH_STATUS\.NEEDS_ASSISTANCE/.test(m.statement))
        .map((m) => m.path);
}

describe('the doors into a waiting run', () => {
    it('scans the server tree (an empty scan is a failure, not a pass)', () => {
        const mutations = batchMutations(scanned);
        // Both numbers, not a verdict. A gate that reports only "passed" is
        // unreadable on the day it quietly stops looking at anything.
        // eslint-disable-next-line no-console
        console.info(
            `waiting-run-doors: scanned ${scanned.length} server file(s), `
            + `found ${mutations.length} migrationBatches mutation(s)`,
        );
        expect(scanned.length).toBeGreaterThan(100);
        expect(mutations.length).toBeGreaterThan(5);
        expect(scanned.some((f) => f.path === THE_DOOR)).toBe(true);
        expect(scanned.some((f) => f.path === THE_WRITER)).toBe(true);
    });

    it('has exactly ONE call site, and it is the guarded one', () => {
        // Named, not counted. A count tells whoever broke this that a number
        // changed; the name tells them which file to open.
        expect(assistanceBatchCallSites(scanned)).toEqual([THE_DOOR]);
    });

    it('asks the owner question BEFORE it opens the run', () => {
        const code = stripComments(scanned.find((f) => f.path === THE_DOOR)?.source ?? '');
        const guardAt = code.indexOf('assertStaffAccessDecisionIsOwners(');
        const openAt = code.indexOf('createAssistanceBatch(');
        // Both present. A `-1` on either would satisfy the ordering below for
        // the wrong reason, because `-1` is less than everything.
        expect(guardAt).toBeGreaterThan(-1);
        expect(openAt).toBeGreaterThan(-1);
        expect(guardAt).toBeLessThan(openAt);
    });

    it('parks a row in the waiting status in ONE place, so no route can do it by hand', () => {
        // The call-site rule is worth nothing on its own: a second door is far
        // likelier to arrive as a NEW method that inserts the status itself
        // than as a second call to the existing one.
        expect(waitingStatusWrites(scanned)).toEqual([THE_WRITER]);
    });

    describe('the scanner itself', () => {
        it('POSITIVE CONTROL — finds an unguarded call in a second file', () => {
            expect(assistanceBatchCallSites([
                { path: 'server/api/somewhere-else.ts', source: 'await stage.createAssistanceBatch({});' },
            ])).toEqual(['server/api/somewhere-else.ts']);
        });

        it('POSITIVE CONTROL — finds a call sitting after a string containing "//"', () => {
            // The blunt stripper's failure: everything after the `//` in the URL
            // disappears, the call with it, and the rule reports clean.
            expect(assistanceBatchCallSites([{
                path: 'server/api/x.ts',
                source: 'const u = "https://example.test"; await s.createAssistanceBatch({});',
            }])).toEqual(['server/api/x.ts']);
        });

        it('NEGATIVE CONTROL — does not count a function NAMED in a comment', () => {
            // Not hypothetical: the real module explains itself in prose that
            // says `createAssistanceBatch` out loud, more than once.
            expect(assistanceBatchCallSites([
                { path: 'server/api/y.ts', source: '// createAssistanceBatch() opens the run\nconst x = 1;' },
                { path: 'server/api/z.ts', source: '/** createAssistanceBatch() is called next door. */\nconst y = 2;' },
            ])).toEqual([]);
        });

        it('NEGATIVE CONTROL — does not count the declaration as a call', () => {
            expect(assistanceBatchCallSites([
                { path: THE_WRITER, source: 'async createAssistanceBatch(params: P) { return 1; }' },
            ])).toEqual([]);
        });

        it('POSITIVE CONTROL — the status rule fires on a hand-written insert', () => {
            expect(waitingStatusWrites([{
                path: 'server/api/sneaky.ts',
                source: 'await db.insert(migrationBatches).values({ tenantId, '
                    + 'status: MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE });',
            }])).toEqual(['server/api/sneaky.ts']);
        });

        it('POSITIVE CONTROL — and on an UPDATE that parks an existing row', () => {
            expect(waitingStatusWrites([{
                path: 'server/api/sneaky.ts',
                source: 'await db.update(migrationBatches)'
                    + '.set({ status: MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE }).where(x);',
            }])).toEqual(['server/api/sneaky.ts']);
        });

        it('NEGATIVE CONTROL — does not read a REPORTED status as a written one', () => {
            // The exact shape that made the first draft of this rule wrong: the
            // guarded route names the status in the JSON it returns, several
            // lines after a mutation of the same table.
            expect(waitingStatusWrites([{
                path: THE_DOOR,
                source: 'await db.update(migrationBatches).set({ vendor }).where(x);\n'
                    + 'return c.json({ data: { status: MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE } }, 201);',
            }])).toEqual([]);
        });
    });
});
