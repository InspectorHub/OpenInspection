#!/usr/bin/env node
/**
 * Local demo seed — a fully-populated Commercial PCA (full_pca) report for
 * manually exercising the report viewer + editor (not a test fixture; the
 * automated suites seed their own data). Mirrors scripts/seed-test-user.mjs's
 * execution pattern (raw SQL through scripts/wrangler.mjs against the LOCAL D1)
 * plus R2 photo puts via `wrangler r2 object put --local`.
 *
 * Seeds THREE inspections under one fresh demo tenant:
 *   1. full_pca      — 500 Commerce Way (office) — every PCA block populated:
 *                      Building Profile, dual sign-off + ASTM conformance,
 *                      PSQ exhibit, document-review table, deviations, TWO
 *                      cost tables (Opinion of Cost + Reserve Schedule),
 *                      Appendix B photos (numbered), and the TOC.
 *   2. light_commercial — 2200 Market Street (retail) — minimal; must NOT
 *      show the ASTM compliance exhibits (sign-off/PSQ/doc-review/appendix)
 *      or the Transmittal Letter / Systems Summary front matter.
 *   3. residential (single_family) — 118 Maple Grove Lane — minimal; must
 *      show NO PCA block at all (pcaReport === null, outline === []).
 *
 *   node scripts/seed-pca-demo.mjs           # seed (idempotent — deletes + re-inserts)
 *   node scripts/seed-pca-demo.mjs --reset   # explicit alias, same behavior
 *
 * Creds (override via env): PCA_DEMO_EMAIL / PCA_DEMO_PASSWORD
 *   default: pca-demo@openinspection.dev / PcaDemo123!
 * (The password is documented here, not printed at the end of the run, to
 * avoid clear-text logging of sensitive data — same as seed-test-user.mjs.)
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG = process.env.WRANGLER_CONFIG || 'wrangler.jsonc';
const wranglerShim = join(import.meta.dirname, 'wrangler.mjs');

function runWrangler(args) {
    execFileSync(process.execPath, [wranglerShim, ...args], {
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, WRANGLER_CONFIG: CONFIG },
        cwd: join(import.meta.dirname, '..'),
    });
}

function runWranglerCapture(args) {
    return execFileSync(process.execPath, [wranglerShim, ...args], {
        stdio: ['ignore', 'pipe', 'inherit'],
        env: { ...process.env, WRANGLER_CONFIG: CONFIG },
        cwd: join(import.meta.dirname, '..'),
        encoding: 'utf8',
    });
}

function d1Exec(sql, label) {
    const sqlFile = join(import.meta.dirname, `.seed-pca-demo.${label}.tmp.sql`);
    writeFileSync(sqlFile, sql, 'utf8');
    try {
        runWrangler(['d1', 'execute', 'DB', '--local', '--file', sqlFile]);
    } finally {
        rmSync(sqlFile, { force: true });
    }
}

function d1Query(sql, label) {
    const sqlFile = join(import.meta.dirname, `.seed-pca-demo.${label}.tmp.sql`);
    writeFileSync(sqlFile, sql, 'utf8');
    try {
        const out = runWranglerCapture(['d1', 'execute', 'DB', '--local', '--file', sqlFile, '--json']);
        // wrangler prints several banner lines (version, warnings — which contain
        // stray '[' from ANSI codes / "[WARNING]") before the JSON result array.
        // The array's opening bracket is always alone on its own line, so anchor
        // on that rather than the first raw '[' in the output.
        const lines = out.split(/\r?\n/);
        const start = lines.findIndex((l) => l.trim() === '[');
        if (start === -1) throw new Error(`Could not locate JSON output in wrangler d1 execute output:\n${out}`);
        return JSON.parse(lines.slice(start).join('\n'));
    } finally {
        rmSync(sqlFile, { force: true });
    }
}

const sq = (s) => String(s).replace(/'/g, "''");
const jsonLit = (v) => `'${sq(JSON.stringify(v))}'`;
const strLit = (s) => (s === null || s === undefined ? 'NULL' : `'${sq(s)}'`);
const numLit = (n) => (n === null || n === undefined ? 'NULL' : String(n));
const boolLit = (b) => (b ? '1' : '0');

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

// Standalone mode with NO SINGLE_TENANT_ID in .dev.vars scopes EVERY query to
// this fixed fallback tenant (server/lib/deployment-profile.ts
// FIXED_TENANT_FALLBACK), so the dev-server session only ever sees rows under
// this id. All seeded rows MUST live here. NOTE: because R2 photo keys embed
// the tenant id (`${tenantId}/inspections/...`) and the public-report photo
// route enforces `key.startsWith(`${tenantId}/inspections/${id}/`)`, the photo
// keys are derived from TENANT_ID below and re-PUT under this path too.
const TENANT_ID = '00000000-0000-0000-0000-000000000000';
// The old (wrong) tenant a prior run may have created — cleaned up on reset so
// the end state is exactly one usable tenant with the fixed id.
const OLD_TENANT_ID = 'seed-pca-demo-tenant';
const TENANT_SLUG = 'pca-demo';
const TENANT_NAME = 'Acme Commercial Inspections';

const USER_ID = 'seed-pca-demo-inspector';
const LOGIN_EMAIL = process.env.PCA_DEMO_EMAIL || 'pca-demo@openinspection.dev';
const LOGIN_PASSWORD = process.env.PCA_DEMO_PASSWORD || 'PcaDemo123!';

const TEMPLATE_FULL = 'seed-pca-demo-template-full';
const TEMPLATE_LIGHT = 'seed-pca-demo-template-light';
const TEMPLATE_RES = 'seed-pca-demo-template-res';

// The inspection GET / results / units endpoints validate `:id` as
// z.string().uuid() (server/api/inspections/core.ts) and 400 on a non-UUID id,
// which made the EDITOR loader fall back to a "Loading…" stub (the commercial
// controls that gate on propertyType then never render). report-data /
// compliance don't UUID-validate, so the published REPORT worked regardless.
// These MUST be valid-format UUIDs — and STABLE (hard-coded, never
// crypto.randomUUID) so the demo URLs are known/navigable. v4 layout
// (version nibble 4, variant nibble 8).
const INSP_FULL = '11111111-1111-4111-8111-111111111111';
const INSP_LIGHT = '22222222-2222-4222-8222-222222222222';
const INSP_RES = '33333333-3333-4333-8333-333333333333';
const INSP_IDS = [INSP_FULL, INSP_LIGHT, INSP_RES];
// Legacy non-UUID ids a prior run may have written — cleaned up on reset.
const OLD_INSP_ID_PREFIX = 'seed-pca-demo-insp-';

const nowSec = Math.floor(Date.now() / 1000);
const nowMs = Date.now();
const daysAgoSec = (n) => nowSec - n * 86400;
const daysAgoMs = (n) => nowMs - n * 86400_000;

/* ------------------------------------------------------------------ */
/* PBKDF2 password hash (matches server/lib/password.ts)               */
/* ------------------------------------------------------------------ */

const toHex = (b) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256);
    return `pbkdf2:${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

/* ------------------------------------------------------------------ */
/* Template schemas (v2 shape: { sections: [{ id, title, items }] })   */
/* ------------------------------------------------------------------ */

function richItem(id, label) {
    return { id, label, type: 'rich' };
}

const TEMPLATE_FULL_SCHEMA = {
    sections: [
        {
            id: 'site', title: 'Site', items: [
                richItem('topography', 'Site Topography & Drainage'),
                richItem('parking-lot', 'Parking Lot & Paving'),
                richItem('landscaping', 'Landscaping & Site Amenities'),
            ],
        },
        {
            id: 'envelope', title: 'Structural Frame & Building Envelope', items: [
                richItem('foundation', 'Foundation & Structural Frame'),
                richItem('exterior-walls', 'Exterior Wall Systems'),
                richItem('windows-doors', 'Windows & Exterior Doors'),
            ],
        },
        {
            id: 'roofing', title: 'Roofing', items: [
                richItem('roof-covering', 'Roof Covering'),
                richItem('roof-drainage', 'Roof Drainage & Flashing'),
            ],
        },
        {
            id: 'mep', title: 'Mechanical, Electrical & Plumbing', items: [
                richItem('hvac', 'HVAC Systems'),
                richItem('electrical', 'Electrical Distribution'),
                richItem('plumbing', 'Plumbing Systems'),
            ],
        },
        {
            id: 'interior', title: 'Interior Elements', items: [
                richItem('lobby-common', 'Lobby & Common Areas'),
                richItem('tenant-spaces', 'Tenant Spaces & Finishes'),
            ],
        },
        {
            id: 'life-safety', title: 'Life Safety / Fire Protection', items: [
                richItem('fire-sprinkler', 'Fire Sprinkler System'),
                richItem('fire-alarm', 'Fire Alarm & Detection'),
            ],
        },
    ],
};

const TEMPLATE_LIGHT_SCHEMA = {
    sections: [
        {
            id: 'site', title: 'Site', items: [
                richItem('site-general', 'General Site Condition'),
                richItem('parking', 'Parking Lot'),
            ],
        },
        {
            id: 'exterior', title: 'Building Exterior', items: [
                richItem('storefront', 'Storefront & Facade'),
                richItem('roof', 'Roof Covering'),
            ],
        },
        {
            id: 'mep', title: 'Mechanical, Electrical & Plumbing', items: [
                richItem('hvac-light', 'HVAC Systems'),
                richItem('electrical-light', 'Electrical Distribution'),
            ],
        },
    ],
};

const TEMPLATE_RES_SCHEMA = {
    sections: [
        {
            id: 'exterior', title: 'Exterior', items: [
                richItem('roof-res', 'Roof'),
                richItem('siding', 'Siding & Trim'),
            ],
        },
        {
            id: 'interior', title: 'Interior', items: [
                richItem('kitchen', 'Kitchen'),
                richItem('bathrooms', 'Bathrooms'),
            ],
        },
        {
            id: 'systems', title: 'Systems', items: [
                richItem('hvac-res', 'HVAC System'),
                richItem('electrical-res', 'Electrical Panel'),
            ],
        },
    ],
};

/* ------------------------------------------------------------------ */
/* Photos (tiny valid 1x1 PNG, same fixture bytes as tests/workers)    */
/* ------------------------------------------------------------------ */

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function photoKey(tenantId, inspectionId, name) {
    return `${tenantId}/inspections/${inspectionId}/photos/${name}`;
}

const FULL_PHOTOS = {
    parkingLot: photoKey(TENANT_ID, INSP_FULL, 'site-parking-01.png'),
    exteriorWalls: photoKey(TENANT_ID, INSP_FULL, 'envelope-northeast-01.png'),
    roof1: photoKey(TENANT_ID, INSP_FULL, 'roof-membrane-01.png'),
    roof2: photoKey(TENANT_ID, INSP_FULL, 'roof-membrane-02.png'),
    hvac: photoKey(TENANT_ID, INSP_FULL, 'mep-rtu-01.png'),
    lobby: photoKey(TENANT_ID, INSP_FULL, 'interior-lobby-01.png'),
    tenantSuite: photoKey(TENANT_ID, INSP_FULL, 'interior-suite-01.png'),
    sprinkler: photoKey(TENANT_ID, INSP_FULL, 'life-safety-sprinkler-01.png'),
};
const LIGHT_PHOTOS = {
    storefront: photoKey(TENANT_ID, INSP_LIGHT, 'exterior-storefront-01.png'),
};

/* ------------------------------------------------------------------ */
/* pcaNarrative (9-key shape, see server/lib/pca-narrative.ts)         */
/* ------------------------------------------------------------------ */

const PCA_NARRATIVE_FULL = {
    transmittalLetter:
        'We have completed a Property Condition Assessment of the office building located at ' +
        '500 Commerce Way, Springfield, IL 62701 (the "Property"), performed in general accordance ' +
        'with ASTM E2018-24, Standard Guide for Property Condition Assessments. This report presents ' +
        'our observations, opinions of probable cost, and recommendations based on a walk-through ' +
        'survey conducted on July 8, 2026.',
    summaryGeneralDescription:
        'The Property is a four-story, steel-frame office building of approximately 42,000 square feet ' +
        'of net rentable area, originally constructed in 1998 with a major common-area renovation in ' +
        '2019. The Consultant is OpenInspection Demo Consulting; the User is the prospective purchaser ' +
        'in connection with a contemplated acquisition financing transaction. The site visit was ' +
        'performed on July 8, 2026.',
    summaryPhysicalCondition:
        'In our opinion, the Property is in fair to average physical condition for its age and use. ' +
        'The most significant deficiencies noted are advanced granule loss and blistering across ' +
        'roughly 30% of the roof membrane near the east parapet, and localized spalling of the brick ' +
        'veneer with exposed, corroding rebar at the northeast corner of the building.',
    summaryRecommendations:
        'We recommend prompt repair of the spalled brick veneer at the northeast corner, budgeting for ' +
        'a partial roof membrane replacement within one to three years, and continued monitoring of the ' +
        'rooftop HVAC package units, which are approaching the end of their expected service life.',
    purpose:
        'The purpose of this assessment is to observe and document the physical condition of the ' +
        'Property in support of the User’s financing due-diligence in the contemplated transaction, ' +
        'and to develop an opinion of probable capital costs for material physical deficiencies.',
    scopeOfWork:
        'The scope of work comprised a walk-through survey of the readily accessible common areas, ' +
        'building exterior, roof, and a representative sample of tenant suites; a review of available ' +
        'owner-furnished documents; and an interview with the property manager. No destructive or ' +
        'invasive testing, and no engineering calculations, were performed.',
    limitationsExceptions:
        'This assessment was limited to conditions that were readily observable at the time of the site ' +
        'visit. Concealed conditions, components not in service at the time of the visit, and areas not ' +
        'made available (including roof-mounted equipment interiors and below-grade utilities) were not ' +
        'evaluated. Three of twenty-four tenant suites were inspected as a representative sample.',
    reconnaissance:
        'A general reconnaissance of the Property and its immediate surroundings was performed, ' +
        'including the adjoining street frontage, surface parking areas, and the relationship of the ' +
        'improvements to neighboring commercial uses. No conditions off-site were observed that would ' +
        'be expected to adversely affect the subject improvements.',
    additionalConsiderations:
        'The following are outside the baseline scope of this assessment and are provided for the ' +
        'User’s information only: seismic risk, wildfire/flood hazard zoning, mold/IAQ, and ADA ' +
        'accessibility compliance were not independently assessed.',
};

/* ------------------------------------------------------------------ */
/* deviations (Phase S store; ASTM §11.4.3)                            */
/* ------------------------------------------------------------------ */

const DEVIATIONS_FULL = [
    {
        id: 'dev-1', area: 'Document Review',
        baselineRequirement: 'ASTM E2018 §8.6 contemplates review of available environmental site assessment records.',
        deviation: 'No Phase I or Phase II Environmental Site Assessment was made available for review.',
        reason: 'Owner confirmed no environmental assessment has been commissioned for this Property; outside the agreed engagement scope.',
    },
    {
        id: 'dev-2', area: 'Structural Frame & Building Envelope',
        baselineRequirement: 'ASTM E2018 §11 contemplates destructive or invasive probing where warranted by observed conditions.',
        deviation: 'No destructive testing was performed on the exterior wall assembly at the northeast corner.',
        reason: 'Scope of work was limited to a non-invasive, visual walk-through survey per the engagement agreement.',
    },
];

const SAMPLING_DECLARATION_FULL = {
    samplingMethod: 'representative',
    unitsTotal: 24,
    unitsInspected: 3,
    basis: 'Three representative tenant suites (approx. 10%, 20%, and 30% of the leasable floors) were ' +
        'inspected per ASTM §4.3.4 representative-sampling guidance.',
};

/* ------------------------------------------------------------------ */
/* SQL builder                                                         */
/* ------------------------------------------------------------------ */

async function buildSql() {
    const pw = await hashPassword(LOGIN_PASSWORD);
    const lines = [];
    const push = (s) => lines.push(s);

    /* ---- Reset (idempotent) -------------------------------------
     * The child-table rows keep their stable `seed-pca%` own-ids, so deleting
     * them by id (NOT by tenant_id) safely removes both any prior-run copies
     * (old OR fixed tenant) without touching unrelated fixed-tenant rows.
     * `inspections` is the exception: its ids are now UUIDs, so it is deleted
     * by BOTH the current UUID ids AND the legacy `seed-pca-demo-insp-%`
     * prefix a prior run wrote (cleanup path). */
    const inspIdList = INSP_IDS.map((id) => strLit(id)).join(', ');
    push(`DELETE FROM document_review_items WHERE id LIKE 'seed-pca%';`);
    push(`DELETE FROM psq_responses WHERE id LIKE 'seed-pca%';`);
    push(`DELETE FROM report_signoff WHERE id LIKE 'seed-pca%';`);
    push(`DELETE FROM cost_items WHERE id LIKE 'seed-pca%';`);
    push(`DELETE FROM inspection_results WHERE id LIKE 'seed-pca%';`);
    push(`DELETE FROM inspections WHERE id IN (${inspIdList}) OR id LIKE '${OLD_INSP_ID_PREFIX}%';`);
    push(`DELETE FROM templates WHERE id LIKE 'seed-pca%';`);
    push(`DELETE FROM users WHERE email = ${strLit(LOGIN_EMAIL)};`);
    // Drop the old (wrong-tenant) rows entirely so exactly one usable tenant
    // remains. tenant_configs + tenants for the OLD id only — the fixed
    // tenant's config is UPSERTED below (never blindly deleted).
    push(`DELETE FROM tenant_configs WHERE tenant_id = ${strLit(OLD_TENANT_ID)};`);
    push(`DELETE FROM tenants WHERE id = ${strLit(OLD_TENANT_ID)};`);

    /* ---- Tenant + owner user (fixed fallback tenant) --------------
     * The fixed tenant row may already exist (e.g. a dev /setup created it),
     * so UPSERT rather than delete+insert. Slug is UNIQUE; the old tenant
     * (which held this slug) is dropped above first, freeing it. */
    push(`INSERT INTO tenants (id, name, slug, tier, status, max_users, deployment_mode, created_at)
        VALUES (${strLit(TENANT_ID)}, ${strLit(TENANT_NAME)}, ${strLit(TENANT_SLUG)}, 'free', 'active', 5, 'shared', ${nowSec})
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, slug = excluded.slug, status = 'active';`);

    push(`INSERT INTO users (id, tenant_id, email, password_hash, name, license_number, role, created_at)
        VALUES (${strLit(USER_ID)}, ${strLit(TENANT_ID)}, ${strLit(LOGIN_EMAIL)}, ${strLit(pw)}, 'Alex Rivera', 'PCA-2024-0142', 'owner', ${nowSec});`);

    // UPSERT: the fixed tenant may already carry a config row; set only the
    // flags the PCA report reads (reserve schedule + estimates), leaving any
    // other columns intact.
    push(`INSERT INTO tenant_configs (tenant_id, show_estimates, enable_repair_list, enable_customer_repair_export,
            reserve_schedule_enabled, reserve_term_years, inflation_rate_bps, updated_at)
        VALUES (${strLit(TENANT_ID)}, 1, 1, 1, 1, 12, 250, ${nowSec})
        ON CONFLICT(tenant_id) DO UPDATE SET
            show_estimates = 1, enable_repair_list = 1, enable_customer_repair_export = 1,
            reserve_schedule_enabled = 1, reserve_term_years = 12, inflation_rate_bps = 250, updated_at = ${nowSec};`);

    /* ---- Templates -------------------------------------------------- */
    push(`INSERT INTO templates (id, tenant_id, name, version, schema, property_type, commercial_subtype, description, created_at)
        VALUES (${strLit(TEMPLATE_FULL)}, ${strLit(TENANT_ID)}, 'Commercial PCA — Office', 1, ${jsonLit(TEMPLATE_FULL_SCHEMA)}, 'commercial', 'office', 'Full ASTM E2018 Property Condition Assessment template.', ${nowSec});`);
    push(`INSERT INTO templates (id, tenant_id, name, version, schema, property_type, commercial_subtype, description, created_at)
        VALUES (${strLit(TEMPLATE_LIGHT)}, ${strLit(TENANT_ID)}, 'Light Commercial — Retail', 1, ${jsonLit(TEMPLATE_LIGHT_SCHEMA)}, 'commercial', 'retail', 'Light commercial condition survey template.', ${nowSec});`);
    push(`INSERT INTO templates (id, tenant_id, name, version, schema, property_type, description, created_at)
        VALUES (${strLit(TEMPLATE_RES)}, ${strLit(TENANT_ID)}, 'Residential — Single Family', 1, ${jsonLit(TEMPLATE_RES_SCHEMA)}, 'single_family', 'Standard single-family home inspection template.', ${nowSec});`);

    /* ---- Inspection 1: FULL PCA (published, every block populated) - */
    const fullFacts = {
        nra: 42000, floorCount: 4, occupancyClass: 'B (Business)',
        sprinklered: 'Full', lastRenovation: '2019-06-01',
    };
    push(`INSERT INTO inspections (
            id, tenant_id, inspector_id, property_address, template_id, date, status, report_status, payment_status,
            price_cents, created_at, payment_required, agreement_required,
            year_built, sqft, property_facts, property_type, commercial_subtype, report_tier,
            pca_narrative, deviations, sampling_declaration
        ) VALUES (
            ${strLit(INSP_FULL)}, ${strLit(TENANT_ID)}, ${strLit(USER_ID)}, ${strLit('500 Commerce Way, Suite 100, Springfield, IL 62701')},
            ${strLit(TEMPLATE_FULL)}, ${strLit('2026-07-08')}, 'completed', 'published', 'paid',
            250000, ${nowSec}, 1, 0,
            1998, 42000, ${jsonLit(fullFacts)}, 'commercial', 'office', 'full_pca',
            ${jsonLit(PCA_NARRATIVE_FULL)}, ${jsonLit(DEVIATIONS_FULL)}, ${jsonLit(SAMPLING_DECLARATION_FULL)}
        );`);

    const fullResultsData = {
        'topography': { rating: 'Satisfactory', notes: 'Site grading directs surface water away from the building foundation on all elevations. No ponding observed.' },
        'parking-lot': {
            rating: 'Monitor',
            notes: 'Asphalt parking lot shows alligator cracking in the northeast quadrant (~1,200 sf). Recommend crack-seal and seal-coat within 24 months to prevent base failure.',
            photos: [{ key: FULL_PHOTOS.parkingLot }],
        },
        'landscaping': { rating: 'Satisfactory', notes: 'Landscaping and site amenities are well maintained; irrigation system operational.' },
        'foundation': { rating: 'Satisfactory', notes: 'No visible cracking, settlement, or moisture intrusion observed at accessible foundation walls.' },
        'exterior-walls': {
            rating: 'Defect',
            notes: 'Spalling brick veneer with exposed, corroding rebar observed at the northeast corner, extending approximately 8 vertical feet. Immediate repair recommended to prevent further water intrusion and masonry displacement.',
            photos: [{ key: FULL_PHOTOS.exteriorWalls }],
        },
        'windows-doors': { rating: 'Satisfactory', notes: 'Storefront glazing and exterior doors are in serviceable condition; weatherstripping intact.' },
        'roof-covering': {
            rating: 'Defect',
            notes: 'Modified-bitumen membrane shows significant granule loss and blistering across roughly 30% of the roof area near the east parapet. Recommend partial membrane replacement within 1–3 years.',
            photos: [{ key: FULL_PHOTOS.roof1 }, { key: FULL_PHOTOS.roof2 }],
        },
        'roof-drainage': { rating: 'Monitor', notes: 'Two roof drains show minor debris accumulation. Recommend cleaning as part of routine maintenance.' },
        'hvac': {
            rating: 'Monitor',
            notes: 'Four rooftop package HVAC units (installed 2011) are approaching the end of their expected 20-year service life. Recommend budgeting for phased replacement within 5–7 years.',
            photos: [{ key: FULL_PHOTOS.hvac }],
        },
        'electrical': { rating: 'Satisfactory', notes: 'Main switchgear and distribution panels are in good condition with no evidence of overheating or corrosion.' },
        'plumbing': { rating: 'Satisfactory', notes: 'Domestic water and sanitary systems are functioning normally; no active leaks observed.' },
        'lobby-common': {
            rating: 'Satisfactory',
            notes: 'Lobby and common-area finishes are in good condition and appear ADA-compliant at accessible routes.',
            photos: [{ key: FULL_PHOTOS.lobby }],
        },
        'tenant-spaces': {
            rating: 'Satisfactory',
            notes: 'Representative sample of three tenant suites inspected; finishes and condition consistent across the sample.',
            photos: [{ key: FULL_PHOTOS.tenantSuite }],
        },
        'fire-sprinkler': {
            rating: 'Satisfactory',
            notes: 'Wet-pipe sprinkler system; annual inspection tag current and no visible impairments.',
            photos: [{ key: FULL_PHOTOS.sprinkler }],
        },
        'fire-alarm': { rating: 'Satisfactory', notes: 'Addressable fire alarm panel tested functional at time of visit; devices appear properly located.' },
    };
    push(`INSERT INTO inspection_results (id, tenant_id, inspection_id, data, last_synced_at)
        VALUES (${strLit('seed-pca-demo-results-full')}, ${strLit(TENANT_ID)}, ${strLit(INSP_FULL)}, ${jsonLit(fullResultsData)}, ${nowSec});`);

    /* Cost items — 2 immediate, 2 short_term, 3 long_term/reserve (eul/effAge/rul) */
    const costItems = [
        { id: 'seed-pca-cost-1', system: 'Envelope', component: 'Brick veneer spalling repair', action: 'repair', costMethod: 'lump_sum', lumpSumCents: 850_000, suggestedRemedy: 'Remove and repoint spalled brick veneer; treat corroded rebar and reinstall masonry ties at the NE corner.', bucket: 'immediate', photoRef: FULL_PHOTOS.exteriorWalls, sortOrder: 0 },
        { id: 'seed-pca-cost-2', system: 'Roofing', component: 'Roof drain & flashing repair', action: 'repair', costMethod: 'lump_sum', lumpSumCents: 420_000, suggestedRemedy: 'Clean roof drains and re-seal deteriorated flashing at parapet penetrations.', bucket: 'immediate', sortOrder: 1 },
        { id: 'seed-pca-cost-3', system: 'Roofing', component: 'Membrane roof replacement (partial)', action: 'replace', costMethod: 'lump_sum', lumpSumCents: 6_500_000, suggestedRemedy: 'Replace modified-bitumen membrane over the affected ~30% (east parapet) area.', bucket: 'short_term', photoRef: FULL_PHOTOS.roof1, sortOrder: 2 },
        { id: 'seed-pca-cost-4', system: 'Paving', component: 'Parking lot seal-coat & restriping', action: 'repair', costMethod: 'lump_sum', lumpSumCents: 2_200_000, suggestedRemedy: 'Crack-seal, seal-coat, and restripe the parking lot; address alligator-cracked NE quadrant.', bucket: 'short_term', sortOrder: 3 },
        { id: 'seed-pca-cost-5', system: 'MEP', component: 'Rooftop HVAC package unit replacement (4 units)', action: 'replace', costMethod: 'lump_sum', lumpSumCents: 18_000_000, suggestedRemedy: 'Replace four rooftop package units at end of service life.', bucket: 'long_term', eul: 20, effAge: 15, rul: 5, photoRef: FULL_PHOTOS.hvac, sortOrder: 4 },
        { id: 'seed-pca-cost-6', system: 'Envelope', component: 'Exterior door & storefront glazing replacement', action: 'replace', costMethod: 'lump_sum', lumpSumCents: 4_500_000, suggestedRemedy: 'Replace storefront glazing systems and exterior door hardware at end of service life.', bucket: 'long_term', eul: 25, effAge: 18, rul: 7, sortOrder: 5 },
        { id: 'seed-pca-cost-7', system: 'Electrical', component: 'Main switchgear replacement', action: 'replace', costMethod: 'lump_sum', lumpSumCents: 9_500_000, suggestedRemedy: 'Replace main electrical switchgear at end of service life.', bucket: 'long_term', eul: 30, effAge: 15, rul: 15, sortOrder: 6 },
    ];
    for (const it of costItems) {
        push(`INSERT INTO cost_items (id, tenant_id, inspection_id, system, component, location, action, cost_method,
                lump_sum_cents, eul, eff_age, rul, suggested_remedy, bucket, photo_ref, sort_order, created_at)
            VALUES (${strLit(it.id)}, ${strLit(TENANT_ID)}, ${strLit(INSP_FULL)}, ${strLit(it.system)}, ${strLit(it.component)}, '', ${strLit(it.action)}, ${strLit(it.costMethod)},
                ${numLit(it.lumpSumCents)}, ${numLit(it.eul ?? null)}, ${numLit(it.effAge ?? null)}, ${numLit(it.rul ?? null)}, ${strLit(it.suggestedRemedy)}, ${strLit(it.bucket)}, ${strLit(it.photoRef ?? null)}, ${it.sortOrder}, ${nowMs});`);
    }

    /* Dual sign-off */
    push(`INSERT INTO report_signoff (id, tenant_id, inspection_id, role, person_id, name, license, qualifications_ref, signed_at, signature_ref, dual_role)
        VALUES (${strLit('seed-pca-demo-signoff-field')}, ${strLit(TENANT_ID)}, ${strLit(INSP_FULL)}, 'field_observer', ${strLit(USER_ID)}, 'Alex Rivera', 'PCA-2024-0142', NULL, ${daysAgoMs(2)}, ${strLit('c2VlZC1kZW1vLXNpZ25hdHVyZS1maWVsZC1vYnNlcnZlcg==')}, 0);`);
    push(`INSERT INTO report_signoff (id, tenant_id, inspection_id, role, person_id, name, license, qualifications_ref, signed_at, signature_ref, dual_role)
        VALUES (${strLit('seed-pca-demo-signoff-pcr')}, ${strLit(TENANT_ID)}, ${strLit(INSP_FULL)}, 'pcr_reviewer', ${strLit('seed-pca-demo-reviewer-jlee')}, 'Jordan Lee, PE', 'PE-IL-0098234', NULL, ${daysAgoMs(1)}, ${strLit('c2VlZC1kZW1vLXNpZ25hdHVyZS1wY3ItcmV2aWV3ZXI=')}, 0);`);

    /* PSQ (received) */
    const psqResponses = {
        ownerOccupied: false,
        yearsOwned: 8,
        knownDeficiencies: 'Roof membrane nearing end of service life; HVAC units original to the 2011 rooftop replacement.',
        pendingLitigation: false,
        recentRepairCosts: '$45,000 (parking lot resurfacing, 2022)',
        warrantiesInEffect: 'Roof manufacturer warranty (expired 2023); HVAC compressor warranty (expired 2016)',
        preventiveMaintenanceLevel: 'Moderate — quarterly HVAC service, annual roof inspection',
        occupancyRate: '92%',
    };
    push(`INSERT INTO psq_responses (id, tenant_id, inspection_id, responses, status, sent_at, received_at, updated_at)
        VALUES (${strLit('seed-pca-demo-psq')}, ${strLit(TENANT_ID)}, ${strLit(INSP_FULL)}, ${jsonLit(psqResponses)}, 'received', ${daysAgoMs(5)}, ${daysAgoMs(3)}, ${daysAgoMs(3)});`);

    /* Document review catalog (17 items, mixed realistic states) */
    const DOC_CATALOG = [
        { k: 'certificate_of_occupancy', l: 'Certificate of Occupancy', s: 10, req: true, rec: true, rev: true },
        { k: 'code_fire_violations', l: 'Building code / fire-safety violation records', s: 20, req: true, rec: true, rev: true },
        { k: 'prior_pcrs', l: 'Prior Property Condition Reports', s: 30, req: true, rec: false, rev: false, notes: 'Owner unable to locate; none provided.' },
        { k: 'drawings_specs', l: 'Construction drawings & specifications', s: 40, req: true, rec: true, rev: true },
        { k: 'rent_roll', l: 'Rent roll / occupancy schedule', s: 50, req: true, rec: true, rev: true },
        { k: 'ada_fha_evaluations', l: 'ADA / FHA accessibility evaluations', s: 60, req: true, rec: false, rev: false, notes: 'Not available; ADA compliance not independently verified.' },
        { k: 'system_age_records', l: 'Major-system age / installation records', s: 70, req: true, rec: true, rev: true },
        { k: 'historical_repair_costs', l: 'Historical repair & replacement costs', s: 80, req: true, rec: true, rev: true },
        { k: 'warranties', l: 'Equipment & roof warranties', s: 90, req: true, rec: true, rev: true },
        { k: 'appraisals', l: 'Appraisals', s: 100, req: false, rec: false, rev: false, na: true, notes: 'Not requested — outside transaction scope.' },
        { k: 'maintenance_records', l: 'Preventive-maintenance records', s: 110, req: true, rec: true, rev: true },
        { k: 'service_contracts', l: 'Service / maintenance contracts', s: 120, req: true, rec: true, rev: false, notes: 'Received; pending detailed review.' },
        { k: 'environmental_reports', l: 'Environmental reports (Phase I/II ESA)', s: 130, req: false, rec: false, rev: false, na: true, notes: 'Phase I ESA not commissioned for this engagement.' },
        { k: 'capital_improvement_plan', l: 'Capital improvement / replacement plan', s: 140, req: true, rec: false, rev: false },
        { k: 'utility_bills', l: 'Utility bills / consumption history', s: 150, req: true, rec: true, rev: true },
        { k: 'zoning_compliance', l: 'Zoning compliance ("legally conforming")', s: 160, req: true, rec: true, rev: true },
        { k: 'previous_reports', l: 'Previous reports reviewed', s: 170, req: true, rec: true, rev: true },
    ];
    for (const d of DOC_CATALOG) {
        push(`INSERT INTO document_review_items (id, tenant_id, inspection_id, document_key, label, requested, received, reviewed, na, notes, sort_order)
            VALUES (${strLit(`seed-pca-demo-doc-${d.k}`)}, ${strLit(TENANT_ID)}, ${strLit(INSP_FULL)}, ${strLit(d.k)}, ${strLit(d.l)}, ${boolLit(d.req)}, ${boolLit(d.rec)}, ${boolLit(d.rev)}, ${boolLit(!!d.na)}, ${strLit(d.notes ?? null)}, ${d.s});`);
    }

    /* ---- Inspection 2: LIGHT COMMERCIAL (minimal, no compliance rows) */
    const lightFacts = { gla: 8500, storefrontCount: 4, anchorTenant: 'Riverside Grocers', parkingSpaces: 60 };
    push(`INSERT INTO inspections (
            id, tenant_id, inspector_id, property_address, template_id, date, status, report_status, payment_status,
            price_cents, created_at, payment_required, agreement_required,
            year_built, sqft, property_facts, property_type, commercial_subtype, report_tier
        ) VALUES (
            ${strLit(INSP_LIGHT)}, ${strLit(TENANT_ID)}, ${strLit(USER_ID)}, ${strLit('2200 Market Street, Retail Strip, Springfield, IL 62701')},
            ${strLit(TEMPLATE_LIGHT)}, ${strLit('2026-07-05')}, 'completed', 'published', 'paid',
            85000, ${nowSec}, 1, 0,
            2005, 8500, ${jsonLit(lightFacts)}, 'commercial', 'retail', 'light_commercial'
        );`);

    const lightResultsData = {
        'site-general': { rating: 'Satisfactory', notes: 'Site condition consistent with age; no drainage concerns observed.' },
        'parking': { rating: 'Satisfactory', notes: 'Parking lot surface in serviceable condition.' },
        'storefront': {
            rating: 'Monitor',
            notes: 'Minor sealant failure at storefront glazing joints; recommend re-sealing within 12 months.',
            photos: [{ key: LIGHT_PHOTOS.storefront }],
        },
        'roof': { rating: 'Satisfactory', notes: 'TPO roof membrane in good condition; last replaced 2018.' },
        'hvac-light': { rating: 'Satisfactory', notes: 'Rooftop units serviced annually; no deficiencies noted.' },
        'electrical-light': { rating: 'Satisfactory', notes: 'Electrical distribution panels in good condition.' },
    };
    push(`INSERT INTO inspection_results (id, tenant_id, inspection_id, data, last_synced_at)
        VALUES (${strLit('seed-pca-demo-results-light')}, ${strLit(TENANT_ID)}, ${strLit(INSP_LIGHT)}, ${jsonLit(lightResultsData)}, ${nowSec});`);

    /* ---- Inspection 3: RESIDENTIAL (minimal, no PCA block at all) --- */
    push(`INSERT INTO inspections (
            id, tenant_id, inspector_id, property_address, template_id, date, status, report_status, payment_status,
            price_cents, created_at, payment_required, agreement_required,
            year_built, sqft, foundation_type, bedrooms, bathrooms, lot_size, property_type
        ) VALUES (
            ${strLit(INSP_RES)}, ${strLit(TENANT_ID)}, ${strLit(USER_ID)}, ${strLit('118 Maple Grove Lane, Springfield, IL 62704')},
            ${strLit(TEMPLATE_RES)}, ${strLit('2026-06-30')}, 'completed', 'published', 'paid',
            45000, ${nowSec}, 1, 0,
            1985, 2400, 'Crawl space', 4, 2.5, '0.35 acres', 'single_family'
        );`);

    const resResultsData = {
        'roof-res': { rating: 'Satisfactory', notes: 'Asphalt shingle roof in good condition; approximately 8 years old.' },
        'siding': { rating: 'Satisfactory', notes: 'Vinyl siding in serviceable condition; no visible damage.' },
        'kitchen': { rating: 'Satisfactory', notes: 'Kitchen finishes and appliances functional at time of inspection.' },
        'bathrooms': { rating: 'Monitor', notes: 'Minor caulking failure at the hall bathroom tub surround; recommend re-caulking.' },
        'hvac-res': { rating: 'Satisfactory', notes: 'Forced-air gas furnace and AC condenser operating normally; approximately 10 years old.' },
        'electrical-res': { rating: 'Satisfactory', notes: '200-amp panel, copper wiring, no double-tapped breakers observed.' },
    };
    push(`INSERT INTO inspection_results (id, tenant_id, inspection_id, data, last_synced_at)
        VALUES (${strLit('seed-pca-demo-results-res')}, ${strLit(TENANT_ID)}, ${strLit(INSP_RES)}, ${jsonLit(resResultsData)}, ${nowSec});`);

    return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* R2 photo puts                                                       */
/* ------------------------------------------------------------------ */

function tinyPngFile() {
    const bin = Buffer.from(TINY_PNG_BASE64, 'base64');
    const p = join(import.meta.dirname, '.seed-pca-demo-tiny.png');
    writeFileSync(p, bin);
    return p;
}

function putPhotos(keys) {
    const file = tinyPngFile();
    try {
        for (const key of keys) {
            runWrangler(['r2', 'object', 'put', `openinspection-photos/${key}`, '--file', file, '--local']);
        }
    } finally {
        rmSync(file, { force: true });
    }
}

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

function verify() {
    // D1/SQLite caps the number of terms in a compound SELECT (UNION ALL) below
    // what 10 tables needs, so run one COUNT(*) statement per table instead —
    // wrangler returns one result-set per statement, in file order.
    // Scope to the seeded rows under the fixed tenant. Child tables use
    // `tenant_id = fixed AND id LIKE 'seed-pca%'` so unrelated fixed-tenant
    // rows (dev-created inspections, etc.) don't inflate the assertion — this
    // is exactly the coordinator's verify shape.
    const seedScope = `tenant_id = '${TENANT_ID}' AND id LIKE 'seed-pca%'`;
    // inspections ids are UUIDs now (editor UUID validation) — scope by the
    // explicit UUID id list under the fixed tenant instead of the seed prefix.
    const inspIdList = INSP_IDS.map((id) => `'${id}'`).join(', ');
    const inspScope = `tenant_id = '${TENANT_ID}' AND id IN (${inspIdList})`;
    const tables = [
        ['tenants', `id = '${TENANT_ID}'`],
        ['users', `tenant_id = '${TENANT_ID}' AND email = '${LOGIN_EMAIL.replace(/'/g, "''")}'`],
        ['tenant_configs', `tenant_id = '${TENANT_ID}'`],
        ['templates', seedScope],
        ['inspections', inspScope],
        ['inspection_results', seedScope],
        ['cost_items', seedScope],
        ['report_signoff', seedScope],
        ['psq_responses', seedScope],
        ['document_review_items', seedScope],
    ];
    const q = tables.map(([t, w]) => `SELECT COUNT(*) AS n FROM ${t} WHERE ${w};`).join('\n');
    const res = d1Query(q, 'verify-counts');
    const rows = tables.map(([t], i) => ({ t, n: res[i]?.results?.[0]?.n ?? -1 }));
    console.log('\n--- Row counts (demo tenant) ---');
    for (const r of rows) console.log(`  ${r.t.padEnd(24)} ${r.n}`);

    const q2 = `
        SELECT id, report_status, property_type, commercial_subtype, report_tier,
               (property_facts IS NOT NULL) AS has_facts,
               (pca_narrative IS NOT NULL) AS has_narrative,
               (deviations IS NOT NULL) AS has_deviations
        FROM inspections WHERE tenant_id = '${TENANT_ID}' AND id IN (${inspIdList}) ORDER BY id;
    `;
    const res2 = d1Query(q2, 'verify-inspections');
    console.log('\n--- Inspections ---');
    for (const r of res2[0]?.results ?? []) console.log(' ', JSON.stringify(r));

    return { rows, inspections: res2[0]?.results ?? [] };
}

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */

const sql = await buildSql();
d1Exec(sql, 'main');

putPhotos([
    ...Object.values(FULL_PHOTOS),
    ...Object.values(LIGHT_PHOTOS),
]);

const summary = verify();

console.log('\n=== seed-pca-demo done ===');
console.log(`Tenant slug: ${TENANT_SLUG}`);
// Do not log the password (clear-text logging of sensitive data) — the default
// / env-override is documented in this script's header comment instead.
console.log(`Login email: ${LOGIN_EMAIL}  (password: see PCA_DEMO_PASSWORD / header default)`);
console.log(`full_pca inspection:      ${INSP_FULL}`);
console.log(`light_commercial inspection: ${INSP_LIGHT}`);
console.log(`residential inspection:      ${INSP_RES}`);
console.log(`Report URL (full_pca):  /report-view/${TENANT_SLUG}/${INSP_FULL}`);
console.log(`Report URL (light):     /report-view/${TENANT_SLUG}/${INSP_LIGHT}`);
console.log(`Report URL (res):       /report-view/${TENANT_SLUG}/${INSP_RES}`);
console.log(`Editor URL (full_pca):  /inspections/${INSP_FULL}/edit`);
console.log(`Editor URL (light):     /inspections/${INSP_LIGHT}/edit`);
console.log(`Editor URL (res):       /inspections/${INSP_RES}/edit`);

const expectedCounts = {
    tenants: 1, users: 1, tenant_configs: 1, templates: 3, inspections: 3,
    inspection_results: 3, cost_items: 7, report_signoff: 2, psq_responses: 1, document_review_items: 17,
};
let allOk = true;
for (const r of summary.rows) {
    const exp = expectedCounts[r.t];
    if (exp !== undefined && Number(r.n) !== exp) {
        console.error(`  ✗ MISMATCH: ${r.t} expected ${exp}, got ${r.n}`);
        allOk = false;
    }
}
console.log(allOk ? '\n✓ all row counts match expected values' : '\n✗ some row counts did NOT match — see above');
process.exitCode = allOk ? 0 : 1;
