/**
 * Looks for personal information in text pulled out of an uploaded document,
 * and REFUSES the file when it finds any.
 *
 * WHAT THIS MODULE DELIBERATELY CANNOT DO, AND WHY THAT IS THE DESIGN.
 *
 * It does not remove anything, and there is no export here that returns a
 * document. The two postures are not variations on one idea:
 *
 *   - A remover that misses something has issued a clean bill of health for a
 *     file that is not clean. Whoever relies on it afterwards is relying on an
 *     assertion this code is in no position to make.
 *   - A refuser that misses something merely fails to help. It has asserted
 *     nothing, and the person who prepared the file is still the person who
 *     decided what was in it.
 *
 * So the answer to "should we also take the names out for them" is no, and it
 * stays no however good the detection gets.
 *
 * WHAT A HIT CARRIES, AND WHAT IT MUST NEVER CARRY.
 *
 * A page number and a category. Not the matched text, not an excerpt, not an
 * offset that could be used to recover one. Echoing the match would copy the
 * personal information into the interface, into the logs and into any error
 * report that quotes them — while refusing the file for containing it. The
 * absence of a `text` field on `PiiHit` is the enforcement; a caller cannot
 * render what it was never given.
 *
 * WHAT A CLEAN RESULT PROVES, WHICH IS LESS THAN IT LOOKS.
 *
 * An empty array means these patterns did not match. It does not mean the file
 * carries no personal information: a name with no label beside it, a
 * hand-lettered address, an address in a format these rules do not know, and
 * anything inside an image all read as clean here. Callers must say so in the
 * words they show the operator, and must not shorten "nothing was detected" to
 * "nothing is there". This is why detection is tuned towards NOT crying wolf:
 * every rule below requires a second signal beyond a bare field label, because
 * the file this flow asks people to upload is a blank vendor template whose
 * every page is covered in the labels `Client`, `Address` and `Signature`. A
 * scanner that refused those would refuse the only file that is safe to send.
 */

/** The kinds of personal information these rules can recognise. Not a claim
 *  about what a document may contain — only about what is looked for. */
export type PiiCategory = 'name' | 'email' | 'phone' | 'address' | 'signature' | 'licence';

/** One finding: which page, and what kind. Nothing else, ever — see above. */
export interface PiiHit {
    page: number;
    category: PiiCategory;
}

/** A capitalised given/family name pair. Two words minimum: one capitalised
 *  word after a label is far more often the next heading than a person. */
const NAME_AFTER_LABEL = String.raw`[A-Z][\p{Ll}'’-]+(?:\s+[A-Z][\p{Ll}'’.-]+)+`;

/** Labels that introduce a person by name. The separator is REQUIRED: without
 *  it `Client Information Sheet` reads as a client called Information Sheet. */
const NAME_LABELS = 'owner|client|buyer|seller|customer|homeowner|tenant|landlord|agent|realtor|contact|attn|inspector|purchaser';

/**
 * Street types, for the address rule. The rule needs a number AND one of these,
 * because a bare number is a quantity ("2400 sq ft") and a bare street type is
 * a word.
 */
const STREET_TYPES = 'street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|circle|cir|place|pl|terrace|terr|highway|hwy|parkway|pkwy|trail|trl|way';

/**
 * The rules, as data.
 *
 * Ordering here fixes the order categories are reported within one page, so a
 * caller rendering the list gets a stable sentence rather than whichever regex
 * happened to run first.
 */
const RULES: readonly { category: PiiCategory; patterns: readonly RegExp[] }[] = [
    {
        category: 'name',
        // `(?:\s+name)?` so `Client Name:` is the same label as `Client:` —
        // the vendor templates use both, sometimes on the same page.
        patterns: [
            new RegExp(
                String.raw`\b(?:${NAME_LABELS})(?:\s+name)?\s*[:-]\s*(?:${NAME_AFTER_LABEL})`
                + String.raw`|\b(?:prepared|inspected|report(?:ed)?)\s+(?:for|by)\s*[:-]?\s*(?:${NAME_AFTER_LABEL})`,
                'iu',
            ),
        ],
    },
    {
        category: 'email',
        patterns: [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
    },
    {
        category: 'phone',
        // Ten digits in one of the shapes a person writes them in. A grouping
        // is required somewhere — a bare run of ten digits is as likely to be a
        // serial number, and this rule refuses files rather than annotating
        // them, so a coin-flip match is worse than a miss.
        patterns: [/(?:\+?1[ .-]?)?(?:\(\d{3}\)\s*|\b\d{3}[ .-])\d{3}[ .-]\d{4}\b/],
    },
    {
        category: 'address',
        // TWO patterns rather than one alternation, because they need different
        // flags and folding them together silently loses one: the street rule
        // is case-insensitive, and the town/state/ZIP rule is NOT — its `[A-Z]{2}`
        // is a state code, and case-folded it matches any two letters, so
        // `sq ft, in 12345` would read as an address.
        patterns: [
            // A house number, up to four words of street name, then a street type.
            new RegExp(String.raw`\b\d{1,6}\s+(?:[A-Za-z0-9.'’-]+\s+){0,4}(?:${STREET_TYPES})\b`, 'iu'),
            // …or a `Town, ST 12345` tail, which is an address wherever it sits.
            /\b[A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+)*,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/u,
        ],
    },
    {
        category: 'signature',
        // A signature BLOCK, not the word. `Signature` on its own line is what
        // every blank template prints above the rule people sign on.
        patterns: [/\b(?:electronically|digitally|e-?)\s*signed\b|\bsigned\s+(?:by|on)\b|\/s\/\s*[A-Z]|\bsignature\s*[:-]\s*[A-Za-z0-9]/i],
    },
    {
        category: 'licence',
        // A licence NUMBER. `License No.` with a blank after it is a label.
        patterns: [/\blic(?:en[cs]e)?\.?\s*(?:no\.?|number|#)\s*[:-]?\s*[A-Za-z-]*\d{2,}|\b(?:nachi|ashi|trec|intnachi)\s*#?\s*\d{3,}/i],
    },
];

/**
 * Every page whose text matches a rule, as one hit per (page, category).
 *
 * De-duplicated on purpose: a page listing forty past clients is one problem
 * with that page, and forty identical findings would bury a second, different
 * category further down the same list. The operator's next action is "fix page
 * 3", and it does not change with the count.
 *
 * Pure and synchronous. It reads text that has already been extracted and
 * touches no I/O, so it can be run before anything is stored — which is the
 * only useful moment, since the point is to refuse the file rather than to
 * annotate one that was kept.
 */
export function scanForPii(pages: readonly string[]): readonly PiiHit[] {
    const hits: PiiHit[] = [];
    pages.forEach((text, page) => {
        if (!text) return;
        for (const rule of RULES) {
            if (rule.patterns.some((re) => re.test(text))) hits.push({ page, category: rule.category });
        }
    });
    return hits;
}
