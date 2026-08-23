#!/usr/bin/env node
/**
 * lint:consent-subjects — a person is a `contacts` row OR a `users` row, and
 * code that only knows about one of them is silently wrong about the other.
 *
 * ── WHAT AN OBJECT THAT FAILS THIS LOOKS LIKE ───────────────────────────────
 * A file that reads or writes the consent / preference ledger — `sms_consent_log`
 * or `notification_preferences`, whose rows are keyed on a (subject_kind,
 * subject_id) PAIR — resolves people out of the database, and names only ONE of
 * the two person tables.
 *
 * The concrete one this gate was written for: the inbound STOP webhook
 * (`server/api/sms.ts`) built its candidate rows from `contacts` alone. A number
 * belonging to a staff member matched nothing, the consent loop ran zero times,
 * and the webhook still answered 200 — so a recipient who texted STOP was
 * recorded nowhere and nothing anywhere reported a problem. The send gate had
 * the same shape one layer down: its number-match fallback read `contacts`, so
 * it could not find the revocation even once one existed.
 *
 * The primitive was already general. `SmsConsentService.record` takes a
 * `subjectKind`, the schema carries the pair, and the settings screen writes
 * user subjects through it. What was missing was the RESOLUTION — the step that
 * decides who the number or the id belongs to. That step is what this gate
 * watches, and it watches it by the crudest available proxy: a file that
 * resolves people for the ledger has to have asked both tables.
 *
 * ── WHY THE MATCHER NEVER READS COMMENTS ────────────────────────────────────
 * Content gates in this repository have been tripped nine times by ordinary
 * prose: a comment naming a path or a symbol reads as an import. Negative
 * sentences are the worst, because explaining that something deliberately does
 * NOT use X requires writing X down. So the source is stripped of comments
 * before anything is matched, in BOTH directions — prose can neither drag a
 * file into scope nor satisfy the rule once it is there. The self-test carries
 * a control for each direction.
 *
 * ── ZERO IS A FAILURE ───────────────────────────────────────────────────────
 * This gate's whole subject is a resolution step that quietly does not happen.
 * A version that walked the wrong directory, matched nothing and printed a
 * clean pass would be committing the defect it exists to catch. So it prints
 * what it scanned beside what it found, on every run, and treats an empty scan
 * or an implausible in-scope count as red.
 *
 * Usage: node scripts/check-consent-subject-kinds.mjs [--self-test]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['server'];
const EXT = /\.(ts|tsx)$/;
const SKIP = /(\.test\.|\.spec\.|\.d\.ts$|[\\/]tests?[\\/])/;

/**
 * The ledger this gate is about: rows keyed on a (subject_kind, subject_id)
 * pair. Touching it is what puts a file in scope — together with an actual
 * person lookup below, because a file that merely delegates has no resolution
 * step to get wrong.
 *
 * The consent SERVICE is not enough on its own, and the first draft of this
 * gate learned that from a false positive: the self-host bootstrap holds an
 * `SmsConsentService` to publish a disclosure VERSION, which has no subject at
 * all, and separately reads `users` to find the admin account. Nothing there
 * resolves a person for a consent row. So the service counts only alongside the
 * one call on it that names a subject.
 */
const LEDGER_TABLE = /\b(smsConsentLog|notificationPreferences)\b/;
const LEDGER_HELPER = /\b(isPreferenceMuted|readSmsConsent|grantSms|revokeChannel|resolveSubjectsForAddress)\s*\(/;
const CONSENT_SERVICE = /\bSmsConsentService\b/;
const SUBJECT_KEYED_CALL = /\.record\s*\(/;

/** The two id spaces a person can be in, as drizzle actually queries them. */
const READS_CONTACTS = /\.from\(\s*contacts\s*\)/;
const READS_USERS = /\.from\(\s*users\s*\)/;

/**
 * Files that resolve ONE id space today, each with the reason it is not fixed
 * here. Declared rather than skipped: an exemption with no reason is
 * indistinguishable from an oversight, and this list is printed on every run so
 * the debt is visible on the days the gate is green.
 *
 * Both directions are checked. A file that leaves this list by being fixed is
 * red until the entry goes, and an entry naming a file that no longer resolves
 * anything is red too — a reason nobody can evaluate is worse than none.
 */
const KNOWN_ONE_SIDED = new Map([
    ['server/lib/compliance/erasure-orchestrator.ts',
        'DELIBERATE and argued at the delete site: it erases `contact` subjects only because a staff member\'s own preferences are not a consumer data subject\'s. Listed rather than skipped so the asymmetry is a recorded decision instead of an oversight.'],
    ['server/services/subject-data.assembler.ts',
        'OPEN: it resolves subjects in the contact space only, and unlike the erasure path states no reason where it does so. What a subject access request returns is a scope decision and is not settled here — changing it would change what a person receives about themselves.'],
]);

/**
 * In-scope files present when this gate was written, verified by hand — the
 * five that resolve a person for the ledger themselves:
 *   server/lib/sms/consent-subjects.ts       (the shared matcher)
 *   server/lib/notifications/channel-consent.ts
 *   server/lib/notifications/preference-port.ts
 *   server/lib/compliance/erasure-orchestrator.ts   ┐ both declared one-sided
 *   server/services/subject-data.assembler.ts       ┘ in KNOWN_ONE_SIDED
 *
 * `server/api/sms.ts` and `server/lib/sms/send-gate.ts` are deliberately NOT in
 * that list: they were, and the fix moved their lookups into the shared matcher,
 * which is the outcome this gate wants. Re-inlining a one-sided query into
 * either still flags — both name the ledger, so they re-enter scope the moment
 * they query a person table again.
 *
 * A FLOOR, not an equality — a sixth file is the case this gate exists for and
 * must not trip it. Finding fewer means either a reader was removed or this
 * scanner stopped recognising one, and those two are indistinguishable from the
 * output, so both stop the build.
 */
const MIN_IN_SCOPE = 4;

function walk(dir, out = []) {
    let entries;
    try { entries = readdirSync(dir); } catch { return out; }
    for (const e of entries) {
        const p = join(dir, e);
        if (e === 'node_modules' || e === '.git') continue;
        if (statSync(p).isDirectory()) walk(p, out);
        else if (EXT.test(e) && !SKIP.test(p)) out.push(p);
    }
    return out;
}

/**
 * Source with every comment removed, and nothing else touched.
 *
 * Quotes and template literals are walked rather than counted, because a `//`
 * inside a string (a URL, a path in an error message) is not a comment and
 * dropping the rest of that line would delete real code. Replacing a block
 * comment with a newline keeps line numbers usable for a reader who greps.
 */
export function stripComments(text) {
    let out = '';
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '/' && text[i + 1] === '/') {
            const nl = text.indexOf('\n', i);
            if (nl < 0) break;
            i = nl - 1;
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            out += '\n';
            if (end < 0) break;
            i = end + 1;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') {
            const quote = c;
            out += c;
            for (i++; i < text.length; i++) {
                out += text[i];
                if (text[i] === '\\') { i++; if (i < text.length) out += text[i]; continue; }
                if (text[i] === quote) break;
            }
            continue;
        }
        out += c;
    }
    return out;
}

/** What this file does with the two id spaces, judged on code alone. */
export function classify(source) {
    const code = stripComments(source);
    const ledger = LEDGER_TABLE.test(code)
        || LEDGER_HELPER.test(code)
        || (CONSENT_SERVICE.test(code) && SUBJECT_KEYED_CALL.test(code));
    const contacts = READS_CONTACTS.test(code);
    const users = READS_USERS.test(code);
    return {
        // A file with no person lookup has no resolution step to get wrong.
        inScope: ledger && (contacts || users),
        contacts,
        users,
        oneSided: ledger && (contacts !== users),
    };
}

/** Zero in scope means the scanner is broken; a clean pass would be a lie. */
export function inScopeIsImplausible(files) {
    return files.length < MIN_IN_SCOPE;
}

function selfTest() {
    const both = `
        import { contacts, smsConsentLog, users } from '../db/schema';
        const a = await db.select({ id: contacts.id }).from(contacts).all();
        const b = await db.select({ id: users.id }).from(users).all();
        await db.insert(smsConsentLog).values(row);
    `;
    // The real shape of the defect: server/api/sms.ts as it was written.
    const contactsOnly = `
        import { contacts } from '../lib/db/schema';
        const candidateRows = await db.select({ id: contacts.id }).from(contacts).all();
        await new SmsConsentService(c.env.DB).record(tenantId, row.id, 'revoked', 'admin', {});
    `;
    // The comment-blindness control, in the shape that has tripped this repo's
    // content gates nine times: the missing symbol appears ONLY in prose, and a
    // negative sentence is what puts it there.
    const contactsOnlyWithProse = `
        // Deliberately does not read users here — see the note on subject kinds.
        /* users.phone is the other id space; this path does not consult it. */
        ${contactsOnly}
    `;
    const usersOnly = `
        const staff = await db.select({ id: users.id }).from(users).all();
        await isPreferenceMuted(db, tenantId, classId, 'sms', subjects);
    `;
    const noLedger = `
        const rows = await db.select({ id: contacts.id }).from(contacts).all();
        return rows.map((r) => r.id);
    `;
    const ledgerOnlyInProse = `
        // smsConsentLog rows are written elsewhere; isPreferenceMuted lives next door.
        const rows = await db.select({ id: contacts.id }).from(contacts).all();
    `;
    const delegatesOnly = `
        import { SmsConsentService } from '../services/sms-consent.service';
        await new SmsConsentService(env.DB).record(tenantId, id, 'revoked', 'admin', meta);
    `;
    // A real shape from this repository, and the false positive that corrected
    // the matcher: the self-host bootstrap publishes a disclosure VERSION (no
    // subject anywhere) and separately looks up the admin account.
    const disclosureBootstrap = `
        import { SmsConsentService } from '../../services/sms-consent.service';
        await new SmsConsentService(db).publishDisclosure(SMS_DISCLOSURE_V1);
        const existingUser = await db.select().from(users).where(eq(users.email, adminEmail)).get();
    `;

    const checks = [
        // POSITIVE CONTROLS — cases that MUST be flagged. Historically these
        // find more than the negative ones do.
        ['a contacts-only consent path is flagged', classify(contactsOnly).oneSided],
        ['prose naming the missing table does NOT satisfy the rule',
            classify(contactsOnlyWithProse).oneSided],
        ['a users-only preference path is flagged', classify(usersOnly).oneSided],

        // NEGATIVE CONTROLS.
        ['a path reading both id spaces is not flagged', !classify(both).oneSided],
        ['a person lookup with no ledger symbol is out of scope', !classify(noLedger).inScope],
        ['a ledger symbol appearing only in prose does not pull a file into scope',
            !classify(ledgerOnlyInProse).inScope],
        ['a file that only delegates has no resolution step and is out of scope',
            !classify(delegatesOnly).inScope],
        ['publishing a disclosure version is not a subject-keyed operation',
            !classify(disclosureBootstrap).inScope],

        // The scope judgement itself.
        ['a flagged file is also in scope', classify(contactsOnly).inScope],
        ['both-sided code is still in scope', classify(both).inScope],

        // The stripper, on the two shapes that break a naive one.
        ['a // inside a string literal is not a comment',
            stripComments(`const u = 'https://example.test'; const x = from(users);`).includes('from(users)')],
        ['a block comment does not eat the code after it',
            stripComments(`/* note */ const x = from(users);`).includes('from(users)')],
        ['a line comment removes only its own line',
            !stripComments(`// from(users)\nconst x = 1;`).includes('from(users)')],

        // This gate's own failure mode.
        ['zero in-scope files is a failure', inScopeIsImplausible([])],
        ['fewer in-scope files than the verified floor is a failure',
            inScopeIsImplausible(new Array(MIN_IN_SCOPE - 1).fill(0))],
        ['the verified floor itself is plausible',
            !inScopeIsImplausible(new Array(MIN_IN_SCOPE).fill(0))],
    ];

    const failed = checks.filter(([, ok]) => !ok);
    for (const [n] of failed) console.error(`  WRONG: ${n}`);
    console.log(`  self-test: ${checks.length} checks, ${failed.length} wrong`);
    return failed.length === 0;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) process.exit(selfTest() ? 0 : 1);
if (!selfTest()) {
    console.error('\n✘ consent-subjects gate: its own self-test failed. Fix the gate before trusting it.');
    process.exit(1);
}

const files = DIRS.flatMap((d) => walk(join(ROOT, d)));
const judged = files.map((f) => ({
    file: relative(ROOT, f).split(sep).join('/'),
    ...classify(readFileSync(f, 'utf8')),
}));

const inScope = judged.filter((j) => j.inScope);
const oneSided = inScope.filter((j) => j.oneSided);
const declared = oneSided.filter((j) => KNOWN_ONE_SIDED.has(j.file));
const flagged = oneSided.filter((j) => !KNOWN_ONE_SIDED.has(j.file));

// Every number side by side, pass or fail. "0 flagged" on its own is
// indistinguishable from a scan that walked the wrong tree and congratulated
// itself, and a gate that speaks only when it is angry cannot be checked on the
// day it is quiet.
console.log(
    `\nconsent-subjects: ${files.length} file(s) scanned, ${inScope.length} resolve people for the `
    + `consent/preference ledger, ${oneSided.length} read only one id space `
    + `— ${flagged.length} undeclared, ${declared.length} declared below.`,
);

if (files.length === 0) {
    console.error('✘ Scanned zero files — the gate is looking in the wrong place, not passing.');
    process.exit(1);
}

if (inScopeIsImplausible(inScope)) {
    console.error(`\n✘ Found ${inScope.length} in-scope file(s); ${MIN_IN_SCOPE} is the hand-verified floor.`);
    console.error('  Either a reader was removed, or this scanner no longer recognises one.');
    console.error('  Those look identical from here, so both stop the build. If a reader genuinely');
    console.error('  went away, lower MIN_IN_SCOPE in scripts/check-consent-subject-kinds.mjs and say why.');
    process.exit(1);
}

// The reverse direction: a declared exemption that no longer applies is a
// reason nobody can evaluate, and it quietly inflates the arithmetic above.
const staleDeclarations = [...KNOWN_ONE_SIDED.keys()]
    .filter((f) => !oneSided.some((j) => j.file === f));
if (staleDeclarations.length > 0) {
    console.error(`\n✘ ${staleDeclarations.length} declared exemption(s) no longer describe the file:\n`);
    for (const f of staleDeclarations) {
        console.error(`    ${f} — it now reads both id spaces, or resolves nobody. Drop the entry.`);
    }
    process.exit(1);
}

for (const d of declared) {
    console.log(`  · ${d.file} — declared: ${KNOWN_ONE_SIDED.get(d.file)}`);
}

if (flagged.length > 0) {
    console.error('\n✘ These files resolve people for a subject-keyed ledger but know only one id space:\n');
    for (const f of flagged) {
        console.error(`    ${f.file} — reads ${f.contacts ? 'contacts' : 'users'}, never ${f.contacts ? 'users' : 'contacts'}`);
    }
    console.error('\n  A consent or preference row is keyed on a (subject_kind, subject_id) pair');
    console.error('  because a person is a contact OR a staff `users` row. Resolving only one of');
    console.error('  the two means the other is silently absent — no error, no log, no refusal.');
    console.error('  Resolve both (see resolveSubjectsForAddress for the shape), or add an entry to');
    console.error('  KNOWN_ONE_SIDED with the reason it must stay one-sided.\n');
    process.exit(1);
}

console.log('✓ Every ledger reader that resolves people asks both id spaces, or says why not.\n');
