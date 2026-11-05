/**
 * A synthetic single-template migration bundle of a chosen size.
 *
 * Every word is invented from a small fixed vocabulary and the output is a pure
 * function of its arguments, so a test using it carries no third-party content
 * and is reproducible byte for byte. The shape mirrors a large real template: a
 * couple of dozen sections, a few hundred rich items, and thousands of canned
 * comments across the Information, Limitations and Defects tabs.
 *
 * The size is reached by growing the comment bodies, then checked against the
 * serialized length, so the caller states the size it needs rather than the
 * number of comments that happens to produce it.
 */
import type { MigrationBundleV1 } from '../../server/lib/migration-intake/bundle';

const VOCAB = [
    'sample', 'fixture', 'component', 'assembly', 'surface', 'joint', 'panel', 'fastener',
    'observed', 'noted', 'visible', 'partial', 'limited', 'typical', 'general', 'minor',
    'condition', 'access', 'finish', 'support', 'alignment', 'clearance', 'seal', 'coating',
    'recommend', 'monitor', 'review', 'repair', 'evaluate', 'document', 'confirm', 'service',
];

function words(seed: number, count: number): string {
    const out: string[] = [];
    let state = seed * 2654435761 % 4294967296;
    for (let i = 0; i < count; i++) {
        state = (state * 1103515245 + 12345) % 2147483648;
        out.push(VOCAB[state % VOCAB.length] as string);
    }
    const text = out.join(' ');
    return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

export interface SyntheticBundleOptions {
    /** Serialized size to reach, in bytes. The result is at least this large. */
    targetBytes: number;
    sections?: number;
    itemsPerSection?: number;
    /** Canned comments per item across the three tabs. */
    commentsPerItem?: number;
}

interface BuildShape {
    sections: number;
    itemsPerSection: number;
    commentsPerItem: number;
    commentWords: number;
}

function build(shape: BuildShape): MigrationBundleV1 {
    let n = 0;
    const sections = Array.from({ length: shape.sections }, (_, s) => ({
        id: `sec-${s}`,
        title: `Synthetic section ${s + 1}`,
        items: Array.from({ length: shape.itemsPerSection }, (_, i) => {
            const itemId = `item-${s}-${i}`;
            const comment = (kind: string, k: number) => {
                n += 1;
                return {
                    id: `${itemId}-${kind}-${k}`,
                    title: `Synthetic ${kind} ${k + 1}`,
                    comment: words(n, shape.commentWords),
                    default: false,
                };
            };
            const per = Math.max(1, Math.floor(shape.commentsPerItem / 3));
            return {
                id: itemId,
                label: `Synthetic item ${s + 1}.${i + 1}`,
                type: 'rich' as const,
                ratingOptions: ['Inspected', 'Not Inspected', 'Repair'],
                tabs: {
                    information: Array.from({ length: per }, (_, k) => comment('information', k)),
                    limitations: Array.from({ length: per }, (_, k) => comment('limitation', k)),
                    defects: Array.from({ length: per }, (_, k) => ({
                        ...comment('defect', k),
                        category: 'recommendation',
                        location: '',
                        photos: [] as string[],
                    })),
                },
            };
        }),
    }));
    const itemCount = shape.sections * shape.itemsPerSection;
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'spectora' },
            adapter: { name: 'staff-conversion', version: '1' },
            counts: {
                template: { readFromSource: 1, emitted: 1, dropped: [] },
                contact: { readFromSource: 0, emitted: 0, dropped: [] },
                member: { readFromSource: 0, emitted: 0, dropped: [] },
            },
            warnings: [],
        },
        templates: [{
            name: 'Synthetic large template',
            schema: { schemaVersion: 2, sections } as MigrationBundleV1['templates'][number]['schema'],
            stats: {
                sections: shape.sections,
                items: itemCount,
                information: 0,
                limitations: 0,
                defects: 0,
                unknownCommentTypes: [],
            },
        }],
        contacts: [],
        members: [],
    };
}

/** Serialized length in bytes, the way a queue message or a staging row carries it. */
export function serializedBytes(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function buildSyntheticTemplateBundle(opts: SyntheticBundleOptions): MigrationBundleV1 {
    const sections = opts.sections ?? 21;
    const itemsPerSection = opts.itemsPerSection ?? 7; // 21 x 7 = 147 items
    const commentsPerItem = opts.commentsPerItem ?? 54; // x 147 = ~7,900 comments
    // Grow the comment body until the serialized size is reached. The size is
    // close to linear in the word count, so a few passes converge.
    let commentWords = 4;
    let bundle = build({ sections, itemsPerSection, commentsPerItem, commentWords });
    for (let pass = 0; pass < 40 && serializedBytes(bundle) < opts.targetBytes; pass++) {
        const have = serializedBytes(bundle);
        commentWords = Math.max(commentWords + 1, Math.ceil(commentWords * (opts.targetBytes / have)));
        bundle = build({ sections, itemsPerSection, commentsPerItem, commentWords });
    }
    return bundle;
}
