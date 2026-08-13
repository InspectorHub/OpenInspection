/**
 * The join between a user-guide page's prose and its screenshots.
 *
 * A guide is two files that must agree:
 *
 *   docs/user-guide/<slug>.md            the prose, written by a person
 *   tests/docs-shots/<slug>.shots.ts     the capture script, no copy in it
 *
 * The prose carries a marker where each screenshot belongs:
 *
 *   <!-- shot: pick-template | The template picker with Residential selected -->
 *
 * It is an HTML comment, so the same file renders on GitHub as a complete
 * text-only guide — self-hosters are not sent to a website to read what the
 * software does. The publisher replaces each marker with the uploaded image to
 * produce the illustrated copy.
 *
 * WHY THE ALT TEXT IS REQUIRED. It is prose, so it belongs with the prose, and
 * this surface is both a screen-reader target and an indexed page. An optional
 * alt attribute is an alt attribute nobody writes.
 *
 * WHY THE ID SETS MUST MATCH EXACTLY. A step captured with nowhere to go, or a
 * marker with no capture, both mean the two files have drifted — which is the
 * failure this whole arrangement exists to prevent. Neither is a warning.
 * (CLAUDE.md § Comment Rules: a "must stay in sync with X" coupling is a latent
 * bug until it is executable.)
 */

/** `<!-- shot: <id> | <alt> -->`, tolerant of internal whitespace. */
const MARKER = /<!--\s*shot:\s*([^|>]*?)\s*(?:\|\s*([\s\S]*?))?\s*-->/g;

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Every marker in a guide, in document order.
 *
 * Malformed markers are RETURNED with an `error`, not dropped: a marker whose
 * id has a typo would otherwise vanish from the marker set and reappear as
 * "capture with no marker", pointing the reader at the wrong file.
 */
export function extractMarkers(markdown) {
    const out = [];
    for (const m of markdown.matchAll(MARKER)) {
        const id = (m[1] ?? '').trim();
        const alt = (m[2] ?? '').trim();
        // Whether the id is USABLE is a separate question from whether the
        // marker is complete. A marker missing its alt text still names a shot
        // the prose asked for, and must still be matched against the captures —
        // otherwise its screenshot is reported a second time as an orphan and
        // the author is sent to the wrong file. Only an unreadable id leaves us
        // with nothing to match.
        const validId = Boolean(id) && ID_RE.test(id);
        let error = null;
        if (!id) error = 'marker has no id';
        else if (!validId) error = `id "${id}" must match ${ID_RE}`;
        else if (!alt) error = `shot "${id}" has no alt text (use "<!-- shot: ${id} | what the picture shows -->")`;
        out.push({ id, alt, validId, error, raw: m[0], index: m.index });
    }
    return out;
}

/**
 * Compare a guide's markers against the captures on disk.
 *
 * Returns every disagreement rather than the first, so one run tells you the
 * whole story instead of one item per fix.
 */
export function validateGuide({ slug, markers, shotIds }) {
    const problems = [];

    for (const m of markers) {
        if (m.error) problems.push(`${slug}: ${m.error}`);
    }

    // Keyed on a usable id, NOT on "the marker was perfect" — see extractMarkers.
    const seen = new Set();
    for (const m of markers) {
        if (!(m.validId ?? (m.id && ID_RE.test(m.id)))) continue;
        if (seen.has(m.id)) problems.push(`${slug}: duplicate marker "${m.id}"`);
        seen.add(m.id);
    }

    const shots = new Set(shotIds);
    const missing = [...seen].filter((id) => !shots.has(id));
    const orphans = [...shots].filter((id) => !seen.has(id));

    if (missing.length) {
        problems.push(
            `${slug}: marker with no capture: ${missing.join(', ')} — the shots script never took ${missing.length === 1 ? 'it' : 'them'}`,
        );
    }
    if (orphans.length) {
        problems.push(
            `${slug}: capture with no marker: ${orphans.join(', ')} — add a marker in the prose or drop the step`,
        );
    }

    return { problems, ids: [...seen], markerCount: markers.length, shotCount: shots.size };
}

/**
 * Replace every marker with its image.
 *
 * Throws on an id with no URL: publishing a guide with a hole in it is worse
 * than not publishing, because the hole is invisible in the rendered page.
 */
export function renderPublished(markdown, urlById) {
    return markdown.replace(MARKER, (raw, rawId, rawAlt) => {
        const id = (rawId ?? '').trim();
        const alt = (rawAlt ?? '').trim();
        const url = urlById[id];
        if (!url) throw new Error(`no uploaded image for shot "${id}"`);
        return `![${alt}](${url})`;
    });
}

/**
 * Strip markers, for a reader who wants the prose with nothing standing in for
 * the pictures. Not used by the publisher — GitHub already hides HTML comments,
 * so the source file IS the text-only edition.
 */
export function stripMarkers(markdown) {
    return markdown.replace(MARKER, '').replace(/\n{3,}/g, '\n\n');
}
