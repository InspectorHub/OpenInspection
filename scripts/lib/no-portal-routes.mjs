/**
 * Portal route literals in this repository's prose.
 *
 * This engine is AGPL and self-hosted by other people. The commercial service
 * that also runs it has its own screens at its own URLs, and those URLs do not
 * exist in a deployment somebody runs themselves — a self-hoster who follows
 * `/company/acme/team` gets a 404 and no explanation.
 *
 * THE LEAK NO SINGLE COMMIT LOOKS LIKE. Nobody sets out to document another
 * product here. It arrives one paired block at a time: a sentence about what
 * hosted does differently, then a URL to make it concrete, then a walkthrough.
 * Each step reads as a helpful clarification, and the result is a manual for
 * software this repository does not contain. A reviewer sees one line; only a
 * gate sees the trend.
 *
 * WHAT IS ALLOWED. The sanctioned way to point at a hosted screen is an
 * absolute link to it — `https://inspectorhub.io/company/acme/team`. That is
 * honest about being somewhere else, it works when clicked, and it cannot be
 * mistaken for a path in this app. Every URL span is therefore stripped before
 * scanning; what is left is a bare path, which is a claim about THIS software.
 *
 * ESCAPE HATCH, because this gate reads prose and prose can need the word:
 *
 *     <!-- no-portal-routes-allow: <reason> -->     (that line only)
 *     <!-- no-portal-routes-allow-file: <reason> --> (the whole file)
 *
 * A reason is REQUIRED — an exemption with no reason is indistinguishable from
 * an oversight. The usual legitimate case is a NEGATIVE statement: explaining
 * that we deliberately do not document a hosted screen means writing the screen
 * down, and a content grep has no way to tell "do not go here" from "go here".
 */

/**
 * Path prefixes that exist only on the hosted service.
 *
 * Every one was checked against `app/routes.ts` and is absent from it. Shared
 * names — `/login`, `/team`, `/settings/billing`, `/verify`, `/join`,
 * `/portal/:tenant` — are deliberately NOT here: they are real routes in this
 * app, and a gate that flagged them would be wrong about its own repository and
 * switched off within a month.
 */
export const PORTAL_PREFIXES = [
    'company',
    'console',
    'register',
    'pricing',
    'features',
    'open-source',
    'software',
    'changelog',
    'tools',
    'contact',
    'compare',
    'guides',
    'use-cases',
    'docs',
];

// The `(?!-->)` is the whole point: `<!-- no-portal-routes-allow: -->` has a
// non-space character after the colon and would otherwise read as a reason.
const ALLOW_LINE = /no-portal-routes-allow:\s*(?!-->)\S/;
const ALLOW_FILE = /no-portal-routes-allow-file:\s*(?!-->)\S/;

/**
 * Anything that is already an absolute URL, in any markdown spelling.
 *
 * `URL_SPAN` only catches a LITERAL host. The other absolute spelling this repo
 * actually uses is a base held in an env var — `${PORTAL_API_URL}/company/switch`
 * — which is the same claim, just not knowable at authoring time. That case is
 * handled by `}` in ROUTE's lookbehind rather than here, because there is no
 * span to strip. Without it, the only correct way to write that sentence would
 * require an exemption comment, and a gate that demands exemptions for correct
 * lines teaches people to reach for the exemption.
 */
const URL_SPAN = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

const ROUTE = new RegExp(String.raw`(?<![\w./}-])/(${PORTAL_PREFIXES.join('|')})(?=$|[/\s.,;:)\]'"` + '`' + String.raw`])`, 'g');

/**
 * Every portal route literal in one document.
 *
 * Returns hits rather than a boolean, each with its line and the path it
 * matched, so the CLI can name them. Line numbers are 1-based.
 */
export function scanText(text) {
    if (ALLOW_FILE.test(text)) return [];

    const hits = [];
    text.split('\n').forEach((line, i) => {
        if (ALLOW_LINE.test(line)) return;
        // Strip URL spans first: the same path inside an https link is the
        // sanctioned way to refer to a hosted screen, so it must not be a hit.
        const bare = line.replace(URL_SPAN, ' ');
        for (const m of bare.matchAll(ROUTE)) {
            hits.push({ kind: 'portal-route', line: i + 1, path: m[0], name: m[1] });
        }
    });
    return hits;
}
