// Commercial PCA Phase W (#186) — Task 1 GO/FALLBACK isolate spike.
// Throwaway-turned-regression-guard: proves `docx` (dolanmiu) actually runs
// under real workerd (not just Node) and that Packer.toBuffer() output
// round-trips byte-for-byte through the PHOTOS R2 binding. This is the
// gating unknown for Phase W — see docs/superpowers/plans/
// 2026-06-26-commercial-pca-phase-w-plan.md Task 1 and
// scripts/spike/word-export-spike.md for the recorded decision.
import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, HeadingLevel, TableOfContents } from 'docx';
import { env } from 'cloudflare:test';

describe('docx-on-Workers spike', () => {
    it('Packer.toBuffer produces a non-empty docx and R2 round-trips it', async () => {
        const doc = new Document({
            features: { updateFields: true }, // makes Word offer to compute the TOC on open
            sections: [{
                children: [
                    new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }),
                    new Paragraph({ text: 'Executive Summary', heading: HeadingLevel.HEADING_1 }),
                    new Paragraph('Representative narrative body text.'),
                ],
            }],
        });
        const buf = await Packer.toBuffer(doc);
        const bytes = new Uint8Array(buf);
        expect(bytes.byteLength).toBeGreaterThan(0);
        // PK zip magic — a valid .docx is a zip.
        expect(bytes[0]).toBe(0x50);
        expect(bytes[1]).toBe(0x4b);

        const key = 'spike/word-export-spike.docx';
        await env.PHOTOS.put(key, bytes);
        const got = await env.PHOTOS.get(key);
        expect(got).not.toBeNull();
        const back = new Uint8Array(await got!.arrayBuffer());
        expect(back.byteLength).toBe(bytes.byteLength);
        expect(back).toEqual(bytes);
        await env.PHOTOS.delete(key);
    });
});
