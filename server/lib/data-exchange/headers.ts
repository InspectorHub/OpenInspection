/**
 * ONE alias dictionary, merged from every entity manifest.
 *
 * The intake registry used to own this literal. It does not any more, and the
 * reason is not tidiness: while the export kept its own hand-written header
 * list and the importer kept this one, their agreement was a coincidence rather
 * than a property — and the coincidence had already broken twice, with `type`
 * exported and unreadable and `notes` exported and readable by no path at all.
 *
 * The merge is what keeps ONE spelling per field across two entry points.
 * `name` and `email` are read by the contacts import and by the member
 * invitation alike; two manifests declaring them separately would be two lists
 * free to drift.
 */
import type { ExchangeVocabulary } from './types';
import { CONTACT_EXCHANGE } from './contacts';
import { MEMBER_EXCHANGE } from './members';

/** Field name to its accepted header spellings, most-preferred first. */
export type IntakeHeaderVocabulary = Readonly<Record<string, readonly string[]>>;

export function headerVocabulary(...vocabularies: ExchangeVocabulary[]): IntakeHeaderVocabulary {
    const merged: Record<string, readonly string[]> = {};
    for (const v of vocabularies) {
        for (const f of v.fields) {
            // An `exportOnly` field advertises no spelling, so it contributes
            // no entry: an alias for a field nothing can import is a promise
            // the mapper will not keep.
            if (f.aliases.length === 0) continue;
            const existing = merged[f.field];
            if (existing && existing.join(' ') !== f.aliases.join(' ')) {
                // A THROW and not a merge. Two manifests that spell one field
                // differently is a question with no right answer at runtime:
                // whichever list wins, one entry point silently stops
                // recognising a heading it used to read.
                throw new Error(
                    `Field "${f.field}" is spelled two ways: [${existing.join(', ')}] and [${f.aliases.join(', ')}]`,
                );
            }
            merged[f.field] = f.aliases;
        }
    }
    return Object.freeze(merged);
}

export const INTAKE_HEADERS: IntakeHeaderVocabulary =
    headerVocabulary(CONTACT_EXCHANGE, MEMBER_EXCHANGE);
