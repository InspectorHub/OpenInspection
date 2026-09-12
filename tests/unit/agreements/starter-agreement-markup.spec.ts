// @vitest-environment happy-dom
/**
 * F46 — the seeded pre-inspection agreement was Markdown, and the signing page
 * is an HTML pipeline. Every new trial tenant's default agreement therefore
 * reached a customer as one run-on paragraph of `##`, `###`, `**` and `- `.
 *
 * This spec holds the fixture to the format the pipeline actually has. happy-dom
 * is required because `normalizeAgreementHtml()` parses through a `<template>`,
 * which is the same thing the author's editor does when it opens the seeded
 * template.
 *
 * Two properties, and the second is the one that matters:
 *
 *  1. No Markdown syntax. A direct, readable check — the exact characters a
 *     signer saw.
 *  2. The body is a FIXED POINT of both passes it goes through: the server's
 *     write-time `sanitizeAgreementHtml()` and the editor's
 *     `normalizeAgreementHtml()`. Property (1) alone would pass for HTML
 *     containing `<a href>` or a `<div>`, neither of which survives to a
 *     signer; a fixed point is the statement "what is seeded is exactly what is
 *     displayed and exactly what is stored back after an untouched save".
 */
import { describe, it, expect } from 'vitest';

import { AGREEMENT_TEMPLATE } from '../../../server/services/starter-content/fixtures/agreement-template';
import { sanitizeAgreementHtml } from '../../../server/services/agreement/sanitizer';
import {
    normalizeAgreementHtml,
    agreementContentToEditorHtml,
    AGREEMENT_EDITOR_TAGS,
} from '../../../app/lib/agreement-markup';

const BODY = AGREEMENT_TEMPLATE.content;

describe('seeded agreement template — format', () => {
    it('is HTML, not Markdown', () => {
        // The ATX headings and the bold runs a signer actually read on screen.
        // ⚠️ NOT anchored with `^…/m`: the blocks are joined with no separator,
        // so there are no line starts to anchor to and an anchored pattern would
        // read clean on a body made entirely of Markdown. Asked unanchored.
        expect(BODY).not.toMatch(/#{1,6} \w/);
        expect(BODY).not.toMatch(/\*\*/);
        // A Markdown bullet. (`$[AMOUNT]` and the `[PLACEHOLDER]` tokens are
        // deliberately NOT asserted against: they are instructions to the
        // operator, not syntax.)
        expect(BODY).not.toMatch(/(^|>)[-*+] /);
        // And the real tags are present, so this cannot pass by the body having
        // been emptied.
        expect(BODY).toContain('<h2>Pre-Inspection Agreement</h2>');
        expect(BODY).toContain('<h3>1. Scope of Inspection</h3>');
        expect(BODY).toContain('<li>Roof, exterior, structure</li>');
        expect(BODY).toContain('<strong>not legal advice</strong>');
    });

    it('uses only tags that survive to a signer', () => {
        const used = new Set<string>();
        for (const match of BODY.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g)) {
            used.add(match[1].toLowerCase());
        }
        expect([...used].sort()).toEqual(
            [...used].filter((t) => (AGREEMENT_EDITOR_TAGS as readonly string[]).includes(t)).sort(),
        );
        // Named explicitly because these three are the repository's standing
        // prohibition for agreement HTML, and a regression would be silent:
        // both sanitizers drop them and keep the surrounding words.
        for (const forbidden of ['a', 'img', 'svg']) expect(used.has(forbidden)).toBe(false);
        // No attributes at all — the serialized form carries none.
        expect(BODY).not.toMatch(/<[a-zA-Z][a-zA-Z0-9-]*\s[^>]*>/);
    });

    it('is unchanged by the server sanitizer it is written through', () => {
        expect(sanitizeAgreementHtml(BODY)).toBe(BODY);
    });

    it('is unchanged by opening it in the editor and saving it untouched', () => {
        // `agreementContentToEditorHtml` is the load path, `normalizeAgreementHtml`
        // the save path. Both must be the identity here, or a tenant who opens
        // the seeded template and saves without editing gets a diff.
        expect(agreementContentToEditorHtml(BODY)).toBe(BODY);
        expect(normalizeAgreementHtml(BODY)).toBe(BODY);
    });

    it('renders as structure, not as one paragraph', () => {
        // The defect a customer saw: everything in a single block. Counting the
        // parsed blocks is what distinguishes "formatted" from "contains tags".
        const host = document.createElement('div');
        host.innerHTML = BODY;
        expect(host.querySelectorAll('h2').length).toBe(1);
        expect(host.querySelectorAll('h3').length).toBe(5);
        expect(host.querySelectorAll('ul').length).toBe(2);
        expect(host.querySelectorAll('li').length).toBe(12);
        // And no Markdown leaked into the rendered TEXT, which is where a
        // signer would see it.
        expect(host.textContent ?? '').not.toContain('##');
        expect(host.textContent ?? '').not.toContain('**');
    });
});
