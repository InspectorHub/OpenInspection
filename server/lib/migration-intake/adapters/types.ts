import type { EntityCounts, MigrationBundleV1, VendorId } from '../bundle';

/**
 * What an adapter returns.
 *
 * A failure is a value, not an exception. An adapter's failure mode is "this
 * file is not what I know how to read", which is the operator's problem to
 * fix; throwing would turn it into an unhandled server condition and lose the
 * sentence that would have told them what to change.
 */
export type BundleResult =
    | { ok: true; bundle: MigrationBundleV1 }
    | { ok: false; error: { code: string; message: string } };

/**
 * What an adapter can say about a file before converting it.
 *
 * A UNION, because the wizard's question differs by what was uploaded and the
 * two questions have nothing in common. A tabular source is asked which column
 * holds what. A template is asked what its rating vocabulary means, because
 * real vendor templates show vocabularies of three, four and five entries
 * sharing no words — severity scales, a yes/no checklist, statutory codes,
 * non-English sets, and templates with no ratings at all. **No mapping from
 * that to our three comment tabs can be written in code**, so the shape has to
 * carry the vocabulary to the person deciding.
 *
 * `null` still means "this adapter cannot read this file" and is NOT a third
 * arm: the wizard reads null as "no question" and an empty arm as "a question
 * with no answers", and those are different screens.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED. `columns` and
 * `template` are OUR arm names, chosen for the question each one lets the
 * wizard ask. Neither is read out of anybody's file.
 */
export type AdapterInspection =
    | {
        kind: 'columns';
        columns: string[];
        /** Sampled rather than complete — enough to recognise a column, not the file. */
        sampleRows: Record<string, string>[];
    }
    | {
        kind: 'template';
        /**
         * The template's own name where the format carries one; null otherwise.
         * Real vendor files carry better names than the filename does.
         */
        name: string | null;
        sections: number;
        items: number;
        /**
         * Verbatim, including leading and trailing whitespace — real files have
         * `' Yes'` and `'Acceptable '`, and normalising here would hide it from
         * the person being asked to classify them.
         */
        ratings: string[];
        /**
         * Which of the file's two possible vocabularies `ratings` is.
         *
         * `'items'` — the words an inspector picks between when he rates an
         * item. Their meaning is genuinely unknown to us: real templates show
         * severity scales, yes/no checklists and statutory codes sharing no
         * words, so the wizard asks.
         *
         * `'comments'` — the words the file files its canned comments under.
         * One real export marks every comment `info`, `limit` or `defect`,
         * which are already our three comment tabs, so the mapping is the
         * identity and there is nothing to ask. Asking anyway would make an
         * inspector re-derive a fact about his own file.
         *
         * A field rather than a second arm of this union: everything else
         * about the two is the same, and a fourth arm would make every reader
         * of `sections`, `items` and `name` handle one more case for a
         * distinction that changes exactly one question.
         *
         * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED. Both values
         * name parts of OUR model; neither is read out of anybody's file.
         */
        ratingsDescribe: 'items' | 'comments';
        /**
         * Whether the format says ratings are shown.
         *
         * `null` means THE PROPERTY WAS ABSENT, which is not the same as false
         * and is the common case. A reader that folds absent into false is
         * asserting something the file did not say.
         */
        ratingsShown: boolean | null;
    };

/**
 * One vendor, one file, one fixture.
 *
 * `convert` is pure: same input, same output, no database, no network, no
 * clock-dependent identity. Everything it needs that is not in the file comes
 * in through `options`.
 */
export interface MigrationAdapter<TOptions> {
    readonly name: string;
    readonly version: string;
    readonly vendor: VendorId;
    /**
     * Report what the wizard has to ask about this file, without converting it.
     *
     * Receives the uploaded file in whatever form the adapter reads — the
     * registry hands text to a text format and bytes to a container one, and
     * the adapter refuses anything else. Widening this to a single form would
     * mean decoding a container as UTF-8, which does not merely fail to parse
     * it but destroys it.
     *
     * OPTIONAL, and its ABSENCE carries meaning: an adapter that does not
     * implement this has nothing for the wizard to ask about, so that step is
     * skipped entirely. The skip is therefore a fact about the adapter's shape
     * rather than a special case somebody remembered to write in the interface.
     *
     * Returns null when the adapter cannot read the input at all.
     */
    inspect?(input: unknown): AdapterInspection | null | Promise<AdapterInspection | null>;
    convert(input: unknown, options: TOptions): BundleResult | Promise<BundleResult>;
}

/** The accounting for an entity kind this adapter emits nothing of. */
export function emptyEntityCounts(): EntityCounts {
    return { readFromSource: 0, emitted: 0, dropped: [] };
}
