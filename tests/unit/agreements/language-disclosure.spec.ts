import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
    AGREEMENT_LANGUAGE_DISCLOSURE as D,
    DISCLOSURE_SANITIZER_PROFILE,
    signaturesRecordCurrentDisclosure,
} from '../../../server/lib/legal/agreement-language-disclosure';
import { sanitizeAgreementHtml } from '../../../server/services/agreement/sanitizer';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('agreement language disclosure', () => {
    it('states the fact', () => {
        expect(D.html).toMatch(/provided in English/i);
        expect(D.html).toMatch(/translated before signing/i);
    });

    it('makes NO contractual assertion', () => {
        // Counsel: a disclosure may state a fact, it may not decide which text
        // prevails. Every word below allocates risk between two parties we are
        // not one of. This test is the line, and it is why the plan was rewritten.
        // The heading is held to the same standard as the sentence: it is shown
        // to the signer in the same block and carries the same risk of reading
        // as a term.
        for (const forbidden of [/govern/i, /prevail/i, /controls?/i,
                                 /binding/i, /conflict between/i, /shall/i]) {
            expect(D.html).not.toMatch(forbidden);
            expect(D.label).not.toMatch(forbidden);
        }
    });

    it('carries a heading that says what the block is NOT', () => {
        // Position is the whole instruction, and a reader does not infer position
        // from a border. The heading states it in words, so it travels with the
        // copy instead of living in whichever component happens to render it.
        expect(D.label).toMatch(/not part of this agreement/i);
        // Plain text: renderers escape it or print it as a text node. Markup here
        // would mean two sanitizer stories for one constant.
        expect(D.label).not.toMatch(/[<>]/);
    });

    it('does not reproduce the InterNACHI clause', () => {
        // That wording is written for the INSPECTOR to place in THEIR agreement.
        // Borrowing it makes the platform the author of a term.
        expect(D.html).not.toMatch(/QUALIFIED EXPERT TRANSLATE THIS AGREEMENT/i);
    });

    it('contains no element the sanitizer strips', () => {
        expect(D.html).not.toMatch(/<(a|img|svg|script|iframe)/i);
    });

    it('is versioned', () => {
        expect(D.version).toBeGreaterThan(0);
    });

    it('is frozen — the copy is not a string a component may edit', () => {
        expect(Object.isFrozen(D)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// This repo is PUBLIC. The module's header used to carry counsel's preliminary
// position, the platform's legal posture, and a citation to a document that
// exists only in the private superproject — and the guard here asserted all of
// it STAYED. That was backwards twice over: it published private legal analysis
// from an open-source file, and it could only be verified from a checkout that
// has the superproject above it, so it failed on CI, where this repo is checked
// out alone. That failure was the useful part: a guard that cannot run where the
// code is published is not guarding the code that is published.
//
// So the guard is inverted. What must survive is the ENGINEERING instruction —
// do not turn this notice into a contractual term, do not grow it into
// translated agreements. What must NOT survive is anything a reader outside this
// company was never meant to see.
// ---------------------------------------------------------------------------
describe('agreement language disclosure — the module stays publishable', () => {
    const MODULE = 'server/lib/legal/agreement-language-disclosure.ts';
    const src = () => readFileSync(join(REPO_ROOT, MODULE), 'utf8');

    it('cites no path outside this repository', () => {
        // A private path in a public file is either a leak or a dead link, and
        // both are found by the same check. `docs/legal/` lives in the
        // superproject; nothing here may reach for it.
        expect(src()).not.toMatch(/docs\/legal\//);
        // Prove the read is of the module and not an empty string.
        expect(src()).toContain('DISCLOSURE_VERSION');
    });

    it('carries no counsel record, jurisdiction analysis, or platform legal posture', () => {
        for (const forbidden of [/counsel/i, /\b1632\b/, /Civil Code/i, /not a party/i]) {
            expect(src(), `${forbidden} reads as private legal material in a public repo`)
                .not.toMatch(forbidden);
        }
    });

    it('still stops the next reader from translating the agreement body', () => {
        // This is the instruction worth keeping, and it survives the pruning
        // above only because it is asserted here. It is engineering guidance —
        // what this feature is not — with no legal claim attached.
        expect(src()).toMatch(/translating the agreement body|agreement BODY/i);
        expect(src()).toMatch(/own legal advice/i);
    });
});

// ---------------------------------------------------------------------------
// What an EVIDENCE surface may say. The signing screen shows a person the copy
// that exists while they are standing there — always truthful. A document
// produced afterwards is making a claim about the past, and may only make it
// when the record supports it.
// ---------------------------------------------------------------------------
describe('agreement language disclosure — what the record supports', () => {
    it('says yes when every signature recorded the version that is live now', () => {
        expect(signaturesRecordCurrentDisclosure([D.version])).toBe(true);
        expect(signaturesRecordCurrentDisclosure([D.version, D.version])).toBe(true);
    });

    it('says no when a signature recorded nothing', () => {
        // Pre-feature signatures, and the on-site API surface where the caller —
        // not the platform — draws the screen.
        expect(signaturesRecordCurrentDisclosure([null])).toBe(false);
        expect(signaturesRecordCurrentDisclosure([undefined])).toBe(false);
    });

    it('says no when a signature recorded a DIFFERENT version', () => {
        // Superseded copy is archived nowhere: a bump replaces the string. So the
        // only alternatives for an older signature are printing nothing and
        // printing words that signer never saw.
        expect(signaturesRecordCurrentDisclosure([D.version - 1])).toBe(false);
        expect(signaturesRecordCurrentDisclosure([D.version + 1])).toBe(false);
    });

    it('needs EVERY signature, not just one — the document is a single record', () => {
        expect(signaturesRecordCurrentDisclosure([D.version, null])).toBe(false);
        expect(signaturesRecordCurrentDisclosure([null, D.version])).toBe(false);
    });

    it('says no on an empty set — "every" is vacuously true and would be a lie', () => {
        // A document with no signatures on it is not a document that shows what
        // anyone was shown.
        expect(signaturesRecordCurrentDisclosure([])).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Who may put a version on the record. Only a surface the PLATFORM renders can
// state what a signer saw; an API that hands the agreement text to a caller and
// takes back a signature knows nothing about the screen in between.
// ---------------------------------------------------------------------------
describe('agreement language disclosure — who may claim a version', () => {
    const PLATFORM_RENDERED_SIGN_ROUTE = 'server/api/bookings/agreement.ts';
    // Moved 2026-08-17: the in-person sign route was split out of
    // `agreements.ts` when that file crossed the 400-line ceiling. The
    // distinction this test is about is unchanged, and is now stated in the new
    // file's own header — the caller drew the screen, so this route cannot
    // attest which disclosure text was on it.
    const CALLER_RENDERED_SIGN_ROUTE = 'server/api/inspections/agreement-sign.ts';

    /** The `languageDisclosureVersion:` argument each sign call passes. */
    function versionArgIn(src: string): string | null {
        const m = src.match(/languageDisclosureVersion:\s*([^,\n]+)/);
        return m ? m[1].trim() : null;
    }

    it('the extractor actually extracts', () => {
        expect(versionArgIn('  languageDisclosureVersion: null,')).toBe('null');
        expect(versionArgIn('const x = 1;')).toBeNull();
    });

    it('the route serving the platform-drawn signing pages records the live version', () => {
        const src = readFileSync(join(REPO_ROOT, PLATFORM_RENDERED_SIGN_ROUTE), 'utf8');
        expect(versionArgIn(src), `${PLATFORM_RENDERED_SIGN_ROUTE} stopped recording a version`)
            .toBe('AGREEMENT_LANGUAGE_DISCLOSURE.version');
    });

    it('the on-site API route records NOTHING — it did not draw the screen', () => {
        // `GET /:id/agreement` hands the agreement text to a caller that renders
        // its own surface. A version written here would assert something the
        // platform cannot know. Give this endpoint a surface we render and the
        // answer changes; until then null is the only true value.
        const src = readFileSync(join(REPO_ROOT, CALLER_RENDERED_SIGN_ROUTE), 'utf8');
        expect(versionArgIn(src), `${CALLER_RENDERED_SIGN_ROUTE} now claims a version it cannot know`)
            .toBe('null');
    });
});

/** Every element name that appears in `html`, lowercased. */
function tagsIn(html: string): string[] {
    return [...html.matchAll(/<\/?([a-z][a-z0-9-]*)\b/gi)].map((m) => m[1].toLowerCase());
}

/** Every attribute name that appears in `html`, lowercased. */
function attrsIn(html: string): string[] {
    return [...html.matchAll(/\s([a-z][a-z0-9-]*)\s*=/gi)].map((m) => m[1].toLowerCase());
}

// DOMPurify is deliberately NOT invoked in this spec. Measured here: under
// happy-dom it drops the outermost element and applies no allow-list at all
// (`<p>hi</p>` sanitizes to `hi`; a `<section role=note>` nested one level deep
// survives a profile that permits neither). A round-trip assertion against it
// would have passed while proving nothing about a browser. What IS faithful is
// DOMPurify's contract — a tag absent from ALLOWED_TAGS is removed — applied to
// the two allow-lists read from their real source below.
describe('agreement language disclosure — what reaches the screen', () => {
    it('its own render profile covers every tag and attribute in the copy', () => {
        for (const tag of tagsIn(D.html)) {
            expect(DISCLOSURE_SANITIZER_PROFILE.ALLOWED_TAGS).toContain(tag);
        }
        for (const attr of attrsIn(D.html)) {
            expect(DISCLOSURE_SANITIZER_PROFILE.ALLOWED_ATTR).toContain(attr);
        }
        // The extractor is the test; prove it can see something.
        expect(tagsIn(D.html)).toContain('section');
        expect(attrsIn(D.html)).toContain('role');
    });

    it('the render profile admits no element that could carry a payload', () => {
        for (const tag of ['a', 'img', 'svg', 'script', 'iframe', 'style', 'form']) {
            expect(DISCLOSURE_SANITIZER_PROFILE.ALLOWED_TAGS).not.toContain(tag);
        }
        for (const attr of DISCLOSURE_SANITIZER_PROFILE.ALLOWED_ATTR) {
            expect(attr).not.toMatch(/^on|href|src|style/i);
        }
    });

    it('the agreement view component would strip the wrapper — so it must not render this', () => {
        // Read the allow-list from <SanitizedHtml>, the component the agreement
        // body is rendered with, rather than restating it here: a copy would go
        // stale and turn this into a green that means nothing.
        const src = readFileSync(join(REPO_ROOT, 'app/components/SanitizedHtml.tsx'), 'utf8');
        const tags = src.match(/const ALLOWED_TAGS = (\[[^\]]*\])/);
        const attrs = src.match(/const ALLOWED_ATTR = (\[[^\]]*\])/);
        expect(tags, 'SanitizedHtml ALLOWED_TAGS moved — this guard went blind').not.toBeNull();
        expect(attrs, 'SanitizedHtml ALLOWED_ATTR moved — this guard went blind').not.toBeNull();
        const viewTags: string[] = JSON.parse(tags![1]);
        const viewAttrs: string[] = JSON.parse(attrs![1]);
        expect(viewTags).toContain('p');

        // DOMPurify removes any tag outside ALLOWED_TAGS, keeping its children. So
        // routing the disclosure through the tenant-content component delivers the
        // sentence with its wrapper gone — a loose paragraph, indistinguishable
        // from a term. Task: render it with DISCLOSURE_SANITIZER_PROFILE instead.
        expect(viewTags).not.toContain('section');
        expect(viewAttrs).not.toContain('role');
    });

    it('is DESTROYED by the agreement-body sanitizer — it is not agreement content', () => {
        // sanitizeAgreementHtml() is the write-time sanitizer for `agreements.content`,
        // and its allow-list is the Quill toolbar: no <section>, no `role`. So the
        // disclosure cannot travel through the agreement pipeline intact — pasted into
        // the body it arrives stripped of the wrapper that marks it as NOT a clause,
        // i.e. as an anonymous paragraph among the terms. That is the failure mode
        // counsel ruled out, and this asserts the pipeline itself refuses the shape.
        const throughAgreementSanitizer = sanitizeAgreementHtml(D.html);
        expect(throughAgreementSanitizer).not.toBe(D.html);
        expect(throughAgreementSanitizer).not.toMatch(/<section/i);
        expect(throughAgreementSanitizer).not.toMatch(/role=/i);
    });
});

// ---------------------------------------------------------------------------
// Containment: the disclosure renders ALONGSIDE the agreement, never inside it.
// ---------------------------------------------------------------------------

const DISCLOSURE_MODULE = 'agreement-language-disclosure';

/** True when `src` pulls in the disclosure copy. */
function importsDisclosure(src: string): boolean {
    return new RegExp(`from\\s+['"][^'"]*${DISCLOSURE_MODULE}['"]|import\\(['"][^'"]*${DISCLOSURE_MODULE}['"]`)
        .test(src);
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
}

// Explicit timeout: the containment tests below walk `server/` and `app/` and
// read every .ts/.tsx file — ~2700 of them. Alone that costs ~5.1s, which is
// already over the 5000ms default; under concurrent vitest workers it loses the
// CPU and fails outright, while a solo re-run passes and reads as a flake. Same
// reasoning as the timeout on the price-capability gate: a spec whose subject is
// "the whole repository" is not a unit test's worth of work, and its budget has
// to say so rather than depend on how loaded the machine is.
describe('agreement language disclosure — containment', { timeout: 30_000 }, () => {
    // The detector is the whole test. A scan that cannot see the thing it looks
    // for passes vacuously forever, so prove it sees one before trusting a zero.
    it('the importer detector actually detects', () => {
        expect(importsDisclosure(
            `import { AGREEMENT_LANGUAGE_DISCLOSURE } from '../lib/legal/${DISCLOSURE_MODULE}';`,
        )).toBe(true);
        expect(importsDisclosure(
            `const m = await import('../../lib/legal/${DISCLOSURE_MODULE}');`,
        )).toBe(true);
        expect(importsDisclosure(`import { sanitizeAgreementHtml } from './sanitizer';`)).toBe(false);
    });

    it('no module that composes the agreement body imports the disclosure', () => {
        const sources = [...walk(join(REPO_ROOT, 'server')), ...walk(join(REPO_ROOT, 'app'))]
            .map((file) => ({ file: relative(REPO_ROOT, file).replace(/\\/g, '/'), src: readFileSync(file, 'utf8') }));

        // Explicit hosts, plus anything that touches the agreement-body sanitizer.
        // Named paths are asserted to exist so a rename fails loudly instead of
        // quietly shrinking the guard to nothing.
        //
        // These are the modules that BUILD THE STRING stored in
        // `agreements.content` (and its pinned snapshot). A document renderer that
        // merely contains that string is a different thing and is governed by the
        // next test — see the note there; listing one here would have forbidden the
        // archived copy from carrying the disclosure at all, which is the one place
        // it matters most.
        const NAMED_HOSTS = [
            'server/services/agreement/sanitizer.ts',
            'server/services/agreement/template.ts',
            'server/services/agreement.service.ts',
        ];
        const known = new Set(sources.map((s) => s.file));
        for (const host of NAMED_HOSTS) expect(known.has(host)).toBe(true);

        const agreementBody = sources.filter(
            (s) => NAMED_HOSTS.includes(s.file)
                || s.file.startsWith('server/services/agreement/')
                || s.src.includes('sanitizeAgreementHtml'),
        );
        expect(agreementBody.length).toBeGreaterThanOrEqual(NAMED_HOSTS.length);

        const offenders = agreementBody.filter((s) => importsDisclosure(s.src)).map((s) => s.file);
        // A neutral platform disclosure that is composed into the contract text is
        // no longer neutral and no longer a disclosure: it is a term we wrote in a
        // contract we are not party to. Render it beside the agreement instead.
        expect(offenders).toEqual([]);
    });

    // The counterpart to the scan above. "Beside the agreement" has to hold on
    // every surface that shows an agreement, and the archived copy is the one a
    // dispute actually produces: a disclosure the signer saw on screen and cannot
    // find in the signed document is worse than no disclosure, because the record
    // then contradicts what happened. So this asserts PRESENCE, and
    // `tests/unit/agreements/agreements-render.spec.ts` asserts the placement —
    // outside the body box, with the stored string untouched.
    it('the archived copy renderer carries the disclosure', () => {
        const RENDERER = 'server/api/agreements-render.ts';
        const src = readFileSync(join(REPO_ROOT, RENDERER), 'utf8');
        expect(importsDisclosure(src), `${RENDERER} no longer shows the disclosure`).toBe(true);
    });

    // Which allow-list the browser pass uses cannot be settled in a DOM test:
    // both components emit the server string on the first pass and only diverge
    // once DOMPurify runs, and DOMPurify under happy-dom applies no allow-list at
    // all. The choice is legible in source, so it is asserted there — and seen for
    // real in a browser.
    const DISCLOSURE_COMPONENT = 'app/components/agreements/AgreementLanguageDisclosure.tsx';

    it('the browser renderer sanitizes with the disclosure profile', () => {
        const src = readFileSync(join(REPO_ROOT, DISCLOSURE_COMPONENT), 'utf8');
        expect(src).toContain('DISCLOSURE_SANITIZER_PROFILE');
    });

    it('the browser renderer does NOT route the copy through the tenant-content component', () => {
        // Its allow-list is the Quill toolbar: no <section>, no `role`. Reusing it
        // would hand the reader a loose paragraph among the terms — the exact
        // reading this disclosure exists to prevent.
        const src = readFileSync(join(REPO_ROOT, DISCLOSURE_COMPONENT), 'utf8');
        expect(/import\s*\{[^}]*\bSanitizedHtml\b[^}]*\}/.test(src)).toBe(false);
    });

    it('every signing surface renders the disclosure component', () => {
        // One import per surface. A surface that grows its own copy of the block,
        // or quietly drops it, shows up here rather than in a dispute.
        const SIGNING_SURFACES = [
            'app/components/portal/sections/AgreementSection.tsx',
            'app/components/checkout/SignCard.tsx',
        ];
        for (const surface of SIGNING_SURFACES) {
            const src = readFileSync(join(REPO_ROOT, surface), 'utf8');
            expect(src, `${surface} does not render the disclosure`)
                .toMatch(/<AgreementLanguageDisclosure\b/);
            // …and it does not reach past the component into the copy itself.
            expect(importsDisclosure(src), `${surface} should render the component, not the copy`)
                .toBe(false);
        }
    });

    it('the verifier ENDPOINT decides the flag from the signed signatures only', () => {
        // A pending signer has been shown nothing and recorded nothing. Folding it
        // into the check would suppress the notice on a document whose actual
        // signatories all saw it — a false negative that looks like caution.
        const src = readFileSync(join(REPO_ROOT, 'server/api/public/verify.ts'), 'utf8');
        expect(src).toContain('signaturesRecordCurrentDisclosure');
        expect(
            /languageDisclosureCurrent[\s\S]{0,400}?status\s*===\s*'signed'/.test(src),
            'the verifier endpoint no longer restricts the check to signed signers',
        ).toBe(true);
    });

    it('the public verifier renders the disclosure ONLY behind the record check', () => {
        // /verify is an evidence surface, not a signing surface: it shows what
        // was signed, to someone who was not there. Reusing the same component is
        // right — one block, one wording — but it may only appear when the server
        // has confirmed every signature recorded the version that is live now.
        // The gate is a server-decided boolean precisely so this page cannot
        // re-derive the rule and drift from the archived copy.
        const src = readFileSync(join(REPO_ROOT, 'app/routes/public/verify.tsx'), 'utf8');
        expect(src).toMatch(/<AgreementLanguageDisclosure\b/);
        expect(
            /languageDisclosureCurrent\s*&&\s*\(?\s*<AgreementLanguageDisclosure\b/.test(src),
            'the verifier renders the disclosure unconditionally — it must be gated on languageDisclosureCurrent',
        ).toBe(true);
    });
});
