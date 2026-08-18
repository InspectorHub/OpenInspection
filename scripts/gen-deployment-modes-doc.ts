/**
 * Generates the capability table in `docs/reference/deployment-modes.md` from
 * the two profile constants, so the doc cannot drift from the code.
 *
 *   npm run docs:modes        # rewrite the table in place
 *
 * The drift gate is `tests/unit/platform/deployment-modes-doc.spec.ts`, which
 * imports `renderModesTable` from here and compares it against what is checked
 * in. A capability added to `DeploymentProfile` with no entry in `DESCRIPTIONS`
 * fails that spec — you cannot ship a mode-dependent behaviour that the
 * self-hosting docs never mention.
 *
 * Why a generator and not a hand-written table: the previous hand-written
 * version of this content said the field form lived at a route that had been
 * deleted, and named an "Admin" role that does not exist. Prose about an enum
 * rots at exactly the rate nobody is checking it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    STANDALONE_PROFILE,
    SAAS_PROFILE,
    type DeploymentProfile,
} from '../server/lib/deployment-profile';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DOC_PATH = join(ROOT, 'docs/reference/deployment-modes.md');

export const START = '<!-- BEGIN GENERATED: capability table -->';
export const END = '<!-- END GENERATED: capability table -->';

/** One line per capability, in the order they should read. */
const DESCRIPTIONS: Record<keyof DeploymentProfile, string> = {
    mode: 'Which profile is active. `APP_MODE=saas` selects saas; anything else is standalone.',
    fixedTenantId:
        'The single tenant every request resolves to. Standalone has exactly one; saas resolves a tenant per request.',
    hasBilling: 'Subscription billing surfaces exist (Settings → Billing).',
    hasSeatQuota: 'The number of team members is capped by a plan.',
    hasUsageQuota: 'Metered usage is capped by a plan.',
    billingPortalUrl: 'Where the browser is sent to manage a subscription.',
    loginRedirectBase:
        'Where the browser is sent to sign in. Standalone serves its own login form; saas bounces to the portal and `POST /api/auth/login` returns 410.',
    hasSetupWizard:
        '`/setup` exists, gated on the `SETUP_CODE` secret, to create the first account.',
    aiDevMockFallback: 'AI calls may fall back to a local mock when no credential resolves.',
    hasManagedAi:
        'A platform-provided AI credential can ever be resolved. Standalone has no platform, so the managed path is absent rather than disabled — use your own key in Settings → Advanced → AI.',
    mcpApiRoute: 'Where the MCP OAuth surface mounts.',
    videoBackendManaged:
        'Whether the platform picks the video backend. Standalone operators set `videoMode` themselves, which is why the self-host settings form exists and the saas one refuses to save.',
    hasManagedCompliance:
        'A platform-operated compliance path (managed SMS 10DLC brand/campaign filing) exists. Absent in standalone — nobody can file on your behalf.',
    hasContentMarketplace:
        'The content marketplace surface exists. Standalone 404s the browse route rather than rendering an empty shelf: the catalogue is curated first-party and nothing can reach it.',
    qboAppManaged:
        'The platform supplies the Intuit app tenants connect through, so nobody is asked for a Client ID. Standalone brings its own: Intuit matches a redirect URI byte for byte and a self-hosted deploy answers on its own domain, so the platform app cannot work there — which is why the credential form, including `QBO_ENV`, renders only in standalone.',
    tenantRecordOwnedByPortal:
        'Whether a platform stores the authoritative tenant record and this worker reads a projection of it. Decides which admin provider is constructed; in standalone this deployment owns the row outright.',
    hasPortalIntegrationApi:
        'Whether the portal machine-to-machine surface (`/api/integration/*`) is mounted. Standalone 404s the whole prefix rather than answering on an API nobody can authenticate to.',
    botProtectionMandatory:
        'Whether the public booking form and agent signup MUST carry a bot challenge. Saas always challenges — with no `TURNSTILE_SECRET_KEY` it uses Cloudflare\'s published test key rather than skipping, so the mechanism is permissive but never off. Standalone leaves it to the operator: no key, no challenge.',
};

/**
 * Values that `getDeploymentProfile` derives per request rather than taking
 * from the constant. Rendering the raw constant would be actively misleading
 * (saas `billingPortalUrl` is `null` in the constant and a real URL at runtime).
 */
const DERIVED: Partial<Record<keyof DeploymentProfile, { standalone?: string; saas?: string }>> = {
    fixedTenantId: {
        standalone: '`SINGLE_TENANT_ID`, or an all-zero UUID when unset',
        saas: 'none — resolved per request',
    },
    billingPortalUrl: { standalone: 'none', saas: 'derived from `PORTAL_API_URL`' },
    loginRedirectBase: { standalone: 'none — local login form', saas: 'derived from `PORTAL_API_URL`' },
};

function cell(value: unknown): string {
    if (value === true) return 'yes';
    if (value === false) return 'no';
    if (value === null) return 'none';
    return `\`${String(value)}\``;
}

/**
 * Rows whose VALUE trips `lint:no-portal-routes`, with the reason.
 *
 * It lives here rather than in the generated markdown because that file is
 * regenerated from this script: an exemption hand-written into the table
 * survives exactly until the next `npm run docs:modes`, and nothing gates the
 * generated file for drift, so it would revert silently.
 *
 * Line-scoped rather than file-scoped on purpose — a file-scoped allow on a
 * generated document would also exempt every hosted path a FUTURE row happens
 * to introduce, which is the leak the gate exists to catch.
 */
const ROUTE_ALLOW: Partial<Record<keyof DeploymentProfile, string>> = {
    mcpApiRoute:
        "this cell is the VALUE of this engine's own mcpApiRoute setting, not a link to a hosted screen",
};

export function renderModesTable(): string {
    const keys = Object.keys(DESCRIPTIONS) as (keyof DeploymentProfile)[];
    const rows = keys.map((k) => {
        const d = DERIVED[k];
        const standalone = d?.standalone ?? cell(STANDALONE_PROFILE[k]);
        const saas = d?.saas ?? cell(SAAS_PROFILE[k]);
        const allow = ROUTE_ALLOW[k] ? ` <!-- no-portal-routes-allow: ${ROUTE_ALLOW[k]} -->` : '';
        return `| \`${k}\` | ${standalone} | ${saas} | ${DESCRIPTIONS[k]} |${allow}`;
    });
    return [
        '| Capability | standalone | saas | What it decides |',
        '|---|---|---|---|',
        ...rows,
    ].join('\n');
}

/** True when this module was run directly rather than imported by the spec. */
const isMain = process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
    const doc = readFileSync(DOC_PATH, 'utf8');
    const start = doc.indexOf(START);
    const end = doc.indexOf(END);
    if (start === -1 || end === -1 || end < start) {
        console.error(`[docs:modes] markers not found in ${DOC_PATH} — expected ${START} … ${END}`);
        process.exit(1);
    }
    const next =
        doc.slice(0, start + START.length) + '\n\n' + renderModesTable() + '\n\n' + doc.slice(end);
    if (next === doc) {
        console.log('[docs:modes] table already current — no write');
    } else {
        writeFileSync(DOC_PATH, next, 'utf8');
        console.log(`[docs:modes] rewrote the capability table (${Object.keys(DESCRIPTIONS).length} capabilities)`);
    }
}
