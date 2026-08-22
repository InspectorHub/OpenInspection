#!/usr/bin/env node
/**
 * OI #58 — non-translatable content registry lint gate.
 *
 * Asserts the internal validity of the registry
 * (`server/lib/legal/non-translatable-manifest.ts` +
 * `non-translatable-out-of-scope.ts`) and HARD-FAILS when an entry has decayed
 * into a string that points at nothing.
 *
 * ── What this gate is FOR, given it guards a feature not yet wired up ───────
 * The `translation` output class is now RELEASED on a workspace's own provider
 * key (`server/lib/ai/output-classification.ts`), but nothing assembles a
 * report into segments yet, so the registry still has no runtime consumer and
 * will not have one until #23's pipeline ships. So the failure
 * mode it defends against is not a bad translation — it is the registry quietly
 * becoming untrue in the months before anything reads it. A `source` gets
 * renamed, a `locator` gets refactored away, someone adds a ninth category to
 * the type and not to the list, and by the time #23 arrives the register looks
 * authoritative and covers half of what it claims.
 *
 * ── The scope is ENUMERATED, not discovered ─────────────────────────────────
 * Sibling gates (erasure, retention) derive their in-scope set from the schema
 * and then demand an answer for each member. This one cannot: "is this text a
 * term of a legal instrument" is not a property of a column name. The in-scope
 * set is the eight categories review named, and it is closed. That makes
 * CATEGORY COVERAGE the load-bearing check here — a registry naming five of
 * eight reads exactly like a complete one, and nothing else in the repo would
 * notice the other three.
 *
 * The gate keeps its OWN copy of the eight and compares it against the source's
 * `NON_TRANSLATABLE_CATEGORIES` in both directions. Two lists that must be
 * equal are printed side by side rather than trusted: a gate whose scope is
 * defined by the file it is checking can be narrowed by editing that file.
 *
 * HARD failures (exit 1):
 *   - either array missing / unparseable (the manifest is not optional)
 *   - ZERO manifest entries parsed          <- "found nothing" == "looked at nothing"
 *   - an entry missing a non-empty id / category / source / locator / reason
 *   - a `category` outside the eight
 *   - a category of the eight with NO entry (coverage)
 *   - a `source` path that does not exist on disk
 *   - a `locator` that does not occur in its `source`
 *   - a manifest source that imports the message catalogue (`~/paraglide/…`)
 *   - a duplicate id, or an id in both arrays
 *   - an out-of-scope entry missing id / source / reason, or naming a missing file
 *   - the source category list and this gate's copy disagreeing either way
 *
 * Usage:
 *   node scripts/check-non-translatable.mjs
 *   node scripts/check-non-translatable.mjs --fixture scripts/fixtures/non-translatable-probe
 *
 * `--fixture` exists so the gate can be proven RED against a probe directory
 * instead of by breaking tracked source and reverting it. In fixture mode the
 * two arrays are read from `<dir>/probe-manifest.ts` and
 * `<dir>/probe-out-of-scope.ts`, and every entry `source` resolves relative to
 * `<dir>`. A probe that mutates tracked source is one interrupted run away from
 * being committed.
 *
 * console.* is intentional — this is a build script, not server code.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const argv = process.argv.slice(2);
const fixtureArg = argv.indexOf("--fixture");
const FIXTURE = fixtureArg === -1 ? null : join(ROOT, argv[fixtureArg + 1] ?? "");

const MANIFEST_FILE = FIXTURE
    ? join(FIXTURE, "probe-manifest.ts")
    : join(ROOT, "server", "lib", "legal", "non-translatable-manifest.ts");
const OUT_OF_SCOPE_FILE = FIXTURE
    ? join(FIXTURE, "probe-out-of-scope.ts")
    : join(ROOT, "server", "lib", "legal", "non-translatable-out-of-scope.ts");
/** Where an entry's `source` path is resolved from. */
const SOURCE_ROOT = FIXTURE ?? ROOT;

/**
 * The eight categories from review review, held here independently of the
 * source so the two can be compared. Order is review, not alphabetical.
 */
const COUNSEL_CATEGORIES = [
    "reliance_clause",
    "limitation_of_liability",
    "arbitration",
    "warranty_disclaimer",
    "governing_law",
    "contract_terms",
    "signature",
    "acknowledgement",
];

/**
 * Importing the message catalogue into a file that holds instrument text is the
 * one mechanical sign of the mistake this registry exists to prevent. Platform
 * notices legitimately do it — which is why they are in the out-of-scope
 * register, and why this check runs on manifest sources only.
 */
const CATALOGUE_IMPORT = /from\s+['"]~\/paraglide\/(messages|runtime)['"]/;

/**
 * Does `locator` still occur in `text`?
 *
 * An identifier-shaped locator is matched on IDENTIFIER BOUNDARIES, not as a
 * substring, and that distinction was also a live hole: renaming
 * `userReliance` to `userRelianceText` left `text.includes('userReliance')`
 * true, so the gate reported coverage of a constant that no longer exists under
 * that name. Prose locators ('Limitation of Liability') stay a plain substring
 * search — a heading is not an identifier and has no boundaries to respect.
 */
function locatorOccurs(text, locator) {
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(locator)) {
        return new RegExp(`(?<![A-Za-z0-9_$])${locator}(?![A-Za-z0-9_$])`).test(text);
    }
    return text.includes(locator);
}

const errors = [];

function readOrDie(path, label) {
    if (!existsSync(path)) {
        console.error(`non-translatable lint: ${label} not found: ${path}`);
        process.exit(1);
    }
    return readFileSync(path, "utf8");
}

const manifestSrc = readOrDie(MANIFEST_FILE, "manifest");
const outOfScopeSrc = readOrDie(OUT_OF_SCOPE_FILE, "out-of-scope register");
// Read as one document: a rule in the first or an exclusion in the second, and
// neither array means anything without the other. Concatenating also means that
// splitting a file for line-count reasons cannot quietly halve what is parsed.
const src = `${manifestSrc}\n${outOfScopeSrc}`;

/**
 * Extract the body of a top-level `export const NAME = [ ... ];` array.
 *
 * The declaration is matched LINE-ANCHORED and with a trailing negative
 * lookahead rather than by `indexOf`. Neither is pedantry; both were live holes
 * found by breaking the registry and watching this gate stay green.
 *
 *  - Without the lookahead, `indexOf('export const NON_TRANSLATABLE_MANIFEST')`
 *    also matches `NON_TRANSLATABLE_MANIFEST_V2`, so renaming the array away
 *    left the gate parsing the renamed one and reporting OK.
 *  - Without the `^` anchor, the match lands inside PROSE. A doc comment in the
 *    renamed-probe fixture quotes the declaration it is describing, and that
 *    quotation was enough to make the gate parse from the middle of a sentence
 *    and report zero entries instead of a missing array. Top-level exports
 *    start at column 0; a mention of one does not.
 *
 * The sibling gates (`check-erasure-manifest.mjs`,
 * `check-retention-manifest.mjs`) inherit the original `indexOf` shape and both
 * weaknesses.
 */
function arrayBody(text, name) {
    const decl = text.search(new RegExp(`^export const ${name}(?![A-Za-z0-9_$])`, "m"));
    if (decl === -1) return null;
    // Skip past the `=` so a type annotation like `: NonTranslatableEntry[]`
    // (whose `[]` would otherwise be mistaken for the array) is not matched.
    const eq = text.indexOf("=", decl);
    if (eq === -1) return null;
    const open = text.indexOf("[", eq);
    if (open === -1) return null;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const ch = text[i];
        if (ch === "[") depth++;
        else if (ch === "]") {
            depth--;
            if (depth === 0) return text.slice(open + 1, i);
        }
    }
    return null;
}

/** Split an array body into its top-level `{ ... }` object literals. */
function objectLiterals(body) {
    const out = [];
    let depth = 0;
    let buf = "";
    for (const ch of body) {
        if (ch === "{") {
            depth++;
            buf += ch;
        } else if (ch === "}") {
            depth--;
            buf += ch;
            if (depth === 0) {
                out.push(buf);
                buf = "";
            }
        } else if (depth > 0) {
            buf += ch;
        }
    }
    return out;
}

/** Pull `key: 'value'` string-literal pairs out of one object literal. */
function parseEntry(literal) {
    const entry = {};
    const re = /(\w+)\s*:\s*'((?:[^'\\]|\\.)*)'/g;
    let m;
    while ((m = re.exec(literal)) !== null) entry[m[1]] = m[2].replace(/\\'/g, "'");
    return entry;
}

function readArray(name) {
    const body = arrayBody(src, name);
    if (body === null) {
        console.error(`non-translatable lint: could not locate ${name} array (must be exported).`);
        process.exit(1);
    }
    return objectLiterals(body).map(parseEntry);
}

/** Read a tuple of bare string literals (`['a', 'b'] as const`). */
function readStringTuple(name) {
    const body = arrayBody(src, name);
    if (body === null) {
        console.error(`non-translatable lint: could not locate ${name} tuple (must be exported).`);
        process.exit(1);
    }
    return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const declaredCategories = readStringTuple("NON_TRANSLATABLE_CATEGORIES");
const manifest = readArray("NON_TRANSLATABLE_MANIFEST");
const outOfScope = readArray("NON_TRANSLATABLE_OUT_OF_SCOPE");

// ── The self-guard, first ────────────────────────────────────────────────────
// Everything below reports on what was parsed, so a parser that found nothing
// would otherwise print a clean bill of health for a file it failed to read.
if (manifest.length === 0) {
    console.error(
        "non-translatable lint: parsed ZERO manifest entries — parser drift or an empty " +
        "registry. A register of what must stay English cannot be empty while the eight " +
        "categories exist.",
    );
    process.exit(1);
}

// ── The category list the gate enforces vs the one the source declares ───────
const declaredSet = new Set(declaredCategories);
const counselSet = new Set(COUNSEL_CATEGORIES);
for (const c of COUNSEL_CATEGORIES) {
    if (!declaredSet.has(c)) {
        errors.push(
            `NON_TRANSLATABLE_CATEGORIES is missing '${c}', which review review named. ` +
            `Dropping a category from the source list would otherwise silently drop it from ` +
            `the coverage check below.`,
        );
    }
}
for (const c of declaredCategories) {
    if (!counselSet.has(c)) {
        errors.push(
            `NON_TRANSLATABLE_CATEGORIES declares '${c}', which is not one of the eight ` +
            `review categories this gate enforces. Widening the registry is a decision that ` +
            `updates COUNSEL_CATEGORIES in scripts/check-non-translatable.mjs too.`,
        );
    }
}

// ── Manifest entries ─────────────────────────────────────────────────────────
const covered = new Set();

manifest.forEach((entry, i) => {
    const label = `manifest #${i + 1} (${entry.id ?? "?"})`;

    for (const field of ["id", "category", "source", "locator", "reason"]) {
        if (!entry[field] || entry[field].trim() === "") {
            errors.push(`${label}: missing/empty '${field}'.`);
        }
    }

    if (entry.category) {
        if (!counselSet.has(entry.category)) {
            errors.push(
                `${label}: category '${entry.category}' is not one of the eight ` +
                `(${COUNSEL_CATEGORIES.join(", ")}).`,
            );
        } else {
            covered.add(entry.category);
        }
    }

    if (!entry.source) return;
    const abs = join(SOURCE_ROOT, entry.source);
    if (!existsSync(abs)) {
        errors.push(
            `${label}: source '${entry.source}' does not exist. The registry names files by ` +
            `PATH rather than importing them, so a moved file leaves an entry that reads as ` +
            `coverage and is not.`,
        );
        return;
    }

    const text = readFileSync(abs, "utf8");
    if (entry.locator && !locatorOccurs(text, entry.locator)) {
        errors.push(
            `${label}: locator '${entry.locator}' does not occur in '${entry.source}'. Renamed ` +
            `or refactored away — re-point the entry at what the content is called now.`,
        );
    }
    if (CATALOGUE_IMPORT.test(text)) {
        errors.push(
            `${label}: '${entry.source}' imports the message catalogue (~/paraglide). This ` +
            `entry declares its content English-authoritative, and rendering it through the ` +
            `catalogue is exactly the contradiction the registry exists to catch. If this file ` +
            `is a platform NOTICE rather than a term of the instrument, it belongs in ` +
            `NON_TRANSLATABLE_OUT_OF_SCOPE with the reason.`,
        );
    }
});

// ── Coverage: all eight, every time ──────────────────────────────────────────
for (const c of COUNSEL_CATEGORIES) {
    if (!covered.has(c)) {
        errors.push(
            `category '${c}' has NO manifest entry. review named eight; a register carrying ` +
            `${covered.size} of them looks complete and is not. Add the entry, or if the ` +
            `content genuinely does not exist in this codebase yet, say so in an entry whose ` +
            `reason states that.`,
        );
    }
}

// ── Out-of-scope register ────────────────────────────────────────────────────
outOfScope.forEach((entry, i) => {
    const label = `out-of-scope #${i + 1} (${entry.id ?? "?"})`;
    for (const field of ["id", "source"]) {
        if (!entry[field] || entry[field].trim() === "") {
            errors.push(`${label}: missing/empty '${field}'.`);
        }
    }
    if (!entry.reason || entry.reason.trim() === "") {
        errors.push(
            `${label}: missing/empty 'reason'. An exclusion without one is a shrug that reads ` +
            `like a decision — and this register is where the platform-notice boundary is ` +
            `written down.`,
        );
    }
    if (entry.source && !existsSync(join(SOURCE_ROOT, entry.source))) {
        errors.push(`${label}: source '${entry.source}' does not exist. Stale exclusion.`);
    }
});

// ── One id, one answer ───────────────────────────────────────────────────────
const seen = new Map();
for (const [arrName, entries] of [
    ["NON_TRANSLATABLE_MANIFEST", manifest],
    ["NON_TRANSLATABLE_OUT_OF_SCOPE", outOfScope],
]) {
    for (const e of entries) {
        if (!e.id) continue;
        if (seen.has(e.id)) {
            const first = seen.get(e.id);
            const where = first === arrName
                ? `twice in ${arrName}`
                : `in both ${first} and ${arrName}`;
            errors.push(
                `id '${e.id}' appears ${where}. One id, one answer; two means a reader takes ` +
                `whichever they found first.`,
            );
        } else {
            seen.set(e.id, arrName);
        }
    }
}

// ── Report ───────────────────────────────────────────────────────────────────
if (errors.length > 0) {
    console.error("\nNon-translatable registry lint FAILED:\n");
    for (const e of errors) console.error("  " + e);
    console.error(`\n${errors.length} error(s).`);
    process.exit(1);
}

console.log(
    `non-translatable lint: OK (${manifest.length} manifest entries covering ` +
    `${covered.size}/${COUNSEL_CATEGORIES.length} review categories, ` +
    `${outOfScope.length} out-of-scope).`,
);
