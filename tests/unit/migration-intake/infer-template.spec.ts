/**
 * What comes back from a model is not a template until somebody has looked at
 * it.
 *
 * Three properties are asserted, and each one exists because the opposite
 * behaviour would produce something that looks right:
 *
 *  1. **It validates before it produces anything.** A structure that does not
 *     satisfy the template schema must not reach the point where it is stored,
 *     because everything downstream — the editor, the report renderer, the
 *     inspection snapshot — assumes it already did.
 *  2. **It NAMES what the model invented rather than dropping it.** A dropped
 *     invention is an item nobody can repair and nothing says went. Silence
 *     here is the failure mode: the operator reviews an outline that reads
 *     fine and never learns a section was thrown away.
 *  3. **It cannot produce anything but a staged result.** Model-assisted text
 *     is not a finding until a person reviews it, and an inferred template is
 *     not a template until somebody has looked at it.
 */
import { describe, it, expect } from 'vitest';
import { TemplateSchemaV2Schema } from '../../../server/lib/validations/template.schema';
import {
    inferredToBundle,
    type InferredProblem,
    type InferredProblemDetail,
} from '../../../server/lib/migration-intake/infer-template';

/**
 * Every problem this step can report.
 *
 * Written out rather than derived, because the point of the closed list is that
 * a screen can be built against it: each of these needs a sentence somebody
 * reads, and a fifth appearing without one would render as a bare enum value.
 * `readonly InferredProblemDetail[]` is what makes this list fail to compile if
 * a member is renamed out from under it.
 */
const EVERY_DETAIL: readonly InferredProblemDetail[] = [
    'unknown item type',
    'could not be read',
    'heading shortened to fit',
    'field we did not ask for',
];

const GOOD_MODEL_OUTPUT = {
    sections: [
        { title: 'Roof', items: [{ title: 'Covering' }, { title: 'Flashing' }] },
        { title: 'Electrical', items: [{ title: 'Panel' }] },
    ],
    unreadable: [],
};

const MODEL_OUTPUT_MISSING_SECTIONS = { unreadable: ['something'] };

const MODEL_OUTPUT_WITH_UNKNOWN_TYPE = {
    sections: [{ title: 'Roof', items: [{ title: 'Covering', type: 'slider' }] }],
    unreadable: [],
};

describe('inferredToBundle: validation', () => {
    it('validates against the template schema before producing a bundle', async () => {
        await expect(inferredToBundle(MODEL_OUTPUT_MISSING_SECTIONS)).rejects.toThrow();
    });

    it('refuses an outline with no sections in it', async () => {
        // An empty outline is a successful-looking failure: it validates, it
        // stages, and the operator is shown a template with nothing in it and
        // no reason why.
        await expect(inferredToBundle({ sections: [], unreadable: [] })).rejects.toThrow();
    });

    it('refuses output that is not an object at all', async () => {
        await expect(inferredToBundle('sections: roof')).rejects.toThrow();
        await expect(inferredToBundle(null)).rejects.toThrow();
    });

    it('POSITIVE CONTROL — a good outline does NOT throw', async () => {
        // Without this, every rejection above passes for a function whose body
        // is a single throw.
        await expect(inferredToBundle(GOOD_MODEL_OUTPUT)).resolves.toBeTruthy();
    });

    it('produces a structure the template schema itself accepts', async () => {
        // The assertions above prove bad input is refused. This one proves the
        // OUTPUT is valid — a converter can reject everything wrong and still
        // emit something the editor cannot open.
        const result = await inferredToBundle(GOOD_MODEL_OUTPUT);
        expect(() => TemplateSchemaV2Schema.parse(result.schema)).not.toThrow();
    });
});

describe('inferredToBundle: what it keeps', () => {
    it('keeps the sections and items in the order they arrived', async () => {
        const result = await inferredToBundle(GOOD_MODEL_OUTPUT);
        expect(result.schema.sections.map((s) => s.title)).toEqual(['Roof', 'Electrical']);
        expect(result.schema.sections[0]?.items.map((i) => i.label)).toEqual(['Covering', 'Flashing']);
    });

    it('gives every section and item a distinct id', async () => {
        // Ids collide silently: the editor renders both, edits one, and saves
        // over the other.
        const result = await inferredToBundle(GOOD_MODEL_OUTPUT);
        const ids = result.schema.sections.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('writes no comment text of its own', async () => {
        // The prompt asks for headings only. If a canned comment ever appears
        // here, something invented prose about a property and put it in a
        // template that inspections are recorded against.
        const result = await inferredToBundle(GOOD_MODEL_OUTPUT);
        for (const section of result.schema.sections) {
            for (const item of section.items) {
                if (item.type !== 'rich') continue;
                expect(item.tabs?.information).toEqual([]);
                expect(item.tabs?.limitations).toEqual([]);
                expect(item.tabs?.defects).toEqual([]);
            }
        }
    });
});

describe('inferredToBundle: what it names', () => {
    it('names what the model invented rather than dropping it', async () => {
        const result = await inferredToBundle(MODEL_OUTPUT_WITH_UNKNOWN_TYPE);
        expect(result.problems.map((p) => p.detail)).toContain('unknown item type');
    });

    it('says WHERE the invention was, not just that there was one', async () => {
        const result = await inferredToBundle(MODEL_OUTPUT_WITH_UNKNOWN_TYPE);
        const problem = result.problems.find((p) => p.detail === 'unknown item type');
        expect(problem?.at).toMatch(/Roof/);
        expect(problem?.at).toMatch(/Covering/);
    });

    it('does not act on an item type the model volunteered, even a real one', async () => {
        // The prompt asks for headings. A type is a guess about the control,
        // and a guessed `boolean` silently strips the item's rating and its
        // three comment tabs — a wrong answer nobody sees until an inspector is
        // half way through an inspection. It is named and not acted on.
        const result = await inferredToBundle({
            sections: [{ title: 'Roof', items: [{ title: 'Covering', type: 'boolean' }] }],
            unreadable: [],
        });
        expect(result.schema.sections[0]!.items[0]!.type).toBe('rich');
        expect(result.problems.map((p) => p.detail)).toContain('field we did not ask for');
    });

    it('POSITIVE CONTROL — an item with no volunteered type reports nothing', async () => {
        // Otherwise the case above passes for a converter that complains about
        // every item, and the problem list stops meaning anything.
        const result = await inferredToBundle({
            sections: [{ title: 'Roof', items: [{ title: 'Covering' }] }],
            unreadable: [],
        });
        expect(result.schema.sections[0]!.items[0]!.type).toBe('rich');
        expect(result.problems).toEqual([]);
    });

    it('POSITIVE CONTROL — a clean outline reports no problems', async () => {
        // Otherwise every "it names the problem" case above passes for a
        // converter that reports the same problem on every outline, and the
        // operator learns to scroll past the list.
        expect((await inferredToBundle(GOOD_MODEL_OUTPUT)).problems).toEqual([]);
    });

    it('carries anything the model could not read through to the operator', async () => {
        // The one signal that distinguishes a confident reading from a poor
        // one. Dropped here, a half-read document produces a short template
        // that looks exactly like a short document.
        const result = await inferredToBundle({
            sections: [{ title: 'Roof', items: [{ title: 'Covering' }] }],
            unreadable: ['a heading nothing could resolve'],
        });
        expect(result.problems.map((p) => p.detail)).toContain('could not be read');
        expect(result.problems.some((p) => p.at.includes('a heading nothing could resolve')))
            .toBe(true);
    });

    it('names a heading it had to shorten rather than shortening it quietly', async () => {
        const result = await inferredToBundle({
            sections: [{ title: 'R'.repeat(120), items: [{ title: 'Covering' }] }],
            unreadable: [],
        });
        expect(result.problems.map((p) => p.detail)).toContain('heading shortened to fit');
        expect(result.schema.sections[0]!.title.length).toBeLessThanOrEqual(50);
    });

    it('names an extra field the model added instead of silently stripping it', async () => {
        const result = await inferredToBundle({
            sections: [{
                title: 'Roof',
                severity: 'major',
                items: [{ title: 'Covering', estimatedCost: 1200 }],
            }],
            unreadable: [],
        });
        expect(result.problems.map((p) => p.detail)).toContain('field we did not ask for');
        expect(result.problems.some((p) => p.at.includes('severity'))).toBe(true);
        expect(result.problems.some((p) => p.at.includes('estimatedCost'))).toBe(true);
    });

    it('reports nothing outside the closed problem list', async () => {
        // A problem detail nobody planned for reaches the operator as an
        // unexplained string. The list is closed so the screen can be built
        // against it; this asserts the code agrees.
        const messy = await inferredToBundle({
            sections: [{
                title: 'R'.repeat(120),
                extra: true,
                items: [{ title: 'Covering', type: 'slider', cost: 1 }],
            }],
            unreadable: ['a heading nothing could resolve'],
        });
        const details: InferredProblemDetail[] = messy.problems.map((p: InferredProblem) => p.detail);
        expect(details.length).toBeGreaterThan(0);
        for (const detail of details) expect(EVERY_DETAIL).toContain(detail);
    });

    it('POSITIVE CONTROL — that messy outline really does hit every kind', async () => {
        // Otherwise the assertion above passes for an outline that produced one
        // problem, and three of the four kinds would go unchecked.
        const messy = await inferredToBundle({
            sections: [{
                title: 'R'.repeat(120),
                extra: true,
                items: [{ title: 'Covering', type: 'slider', cost: 1 }],
            }],
            unreadable: ['a heading nothing could resolve'],
        });
        const details = new Set(messy.problems.map((p) => p.detail));
        for (const detail of EVERY_DETAIL) expect(details).toContain(detail);
    });

    it('does not carry the invented field into the template', async () => {
        // Naming it is not enough — the schema is strict, and a field we pass
        // through is a field the editor then has to have an opinion about.
        const result = await inferredToBundle({
            sections: [{ title: 'Roof', items: [{ title: 'Covering', estimatedCost: 1200 }] }],
            unreadable: [],
        });
        expect(JSON.stringify(result.schema)).not.toMatch(/estimatedCost|1200/);
    });
});

describe('inferredToBundle: it is not a template yet', () => {
    it('cannot reach a template without passing through review', async () => {
        const result = await inferredToBundle(GOOD_MODEL_OUTPUT);
        expect(result.status).toBe('staged');
        expect(result.status).not.toBe('applied');
    });

    it('says so even when there is nothing to correct', async () => {
        // A clean conversion is the case where "surely this one is fine" gets
        // said. The status does not depend on the problem count.
        const result = await inferredToBundle(GOOD_MODEL_OUTPUT);
        expect(result.problems).toEqual([]);
        expect(result.status).toBe('staged');
    });
});
