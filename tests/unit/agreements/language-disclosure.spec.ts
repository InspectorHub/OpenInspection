import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
    AGREEMENT_LANGUAGE_DISCLOSURE as D,
    DISCLOSURE_SANITIZER_PROFILE,
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
        for (const forbidden of [/govern/i, /prevail/i, /controls?/i,
                                 /binding/i, /conflict between/i, /shall/i]) {
            expect(D.html).not.toMatch(forbidden);
        }
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

describe('agreement language disclosure — containment', () => {
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

    it('no module that builds the agreement body imports the disclosure', () => {
        const sources = [...walk(join(REPO_ROOT, 'server')), ...walk(join(REPO_ROOT, 'app'))]
            .map((file) => ({ file: relative(REPO_ROOT, file).replace(/\\/g, '/'), src: readFileSync(file, 'utf8') }));

        // Explicit hosts, plus anything that touches the agreement-body sanitizer.
        // Named paths are asserted to exist so a rename fails loudly instead of
        // quietly shrinking the guard to nothing.
        const NAMED_HOSTS = [
            'server/services/agreement/sanitizer.ts',
            'server/services/agreement/template.ts',
            'server/services/agreement.service.ts',
            'server/api/agreements-render.ts',
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
});
