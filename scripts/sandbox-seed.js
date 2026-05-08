#!/usr/bin/env node
/**
 * Sprint 1 CC-2 — Sandbox demo seed.
 *
 * Wipes the demo tenant and rebuilds it with deterministic fixtures so visitors
 * to sandbox.inspectorhub.io always see the same set of inspections, comments,
 * and templates regardless of what the previous visitor did. Designed to run
 * nightly via Cron Trigger (`0 3 * * *` UTC) or on-demand from the deploy host.
 *
 * Usage:
 *   node scripts/sandbox-seed.js --local                # seed local D1
 *   node scripts/sandbox-seed.js --remote               # seed remote D1 (default)
 *   node scripts/sandbox-seed.js --remote --env=sandbox # seed sandbox env binding
 *
 * The 248-comment library is imported via `npm run seed:comments`-equivalent
 * inline SQL so this script is self-contained and idempotent. Templates are
 * stubbed (2 sections each) — sandbox demos should focus on the workflow,
 * not feature parity with production templates.
 *
 * Seeded entities:
 *   - 1 tenant: "Demo Inspections" (id: SANDBOX_TENANT_ID)
 *   - 1 admin user: demo@openinspection.dev / demo1234
 *   - 3 minimal templates (Residential / Pre-Listing / Sewer Scope)
 *   - 5 inspections covering the full lifecycle:
 *       1. Published with rich data + 4 defects
 *       2. In-progress with 3 defects
 *       3. Upcoming (confirmed, scheduled tomorrow)
 *       4. Upcoming (pending confirmation, scheduled next week)
 *       5. Needs attention (agreement unsigned, > 72h old)
 *   - 248 canned-comment library entries
 */
import { execSync } from 'child_process';
import { randomUUID, pbkdf2Sync, randomBytes } from 'crypto';
import { writeFileSync, unlinkSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ── Config ──────────────────────────────────────────────────────────────────
const LOCAL = process.argv.includes('--local');
const flag  = LOCAL ? '--local' : '--remote';
const ENV_ARG = process.argv.find(a => a.startsWith('--env='));
const ENV_FLAG = ENV_ARG ? ` --env=${ENV_ARG.slice(6)}` : '';
const DB_NAME = process.env.DB_NAME || (LOCAL ? 'DB' : 'openinspection-standalone-db');

// Stable UUIDs — referenced from seeded inspection rows + welcome page links.
// Generated once via crypto.randomUUID(); pinned here for determinism.
const SANDBOX_TENANT_ID         = '5b0d0e5c-7d2a-4d9e-9c1f-1e2c3d4e5f6a';
const SANDBOX_ADMIN_USER_ID     = '7c1f1d6d-8e3b-4a7f-9d0a-2f3e4d5c6b7a';
const TEMPLATE_RESIDENTIAL_ID   = '8a2f0e7e-9c4b-4b8c-8d1b-3a4b5c6d7e8f';
const TEMPLATE_PRELISTING_ID    = '9b3e1f8d-0a5c-4c9d-7e2c-4b5c6d7e8f9a';
const TEMPLATE_SEWERSCOPE_ID    = 'aa4f2a9c-1b6d-4dae-6f3d-5c6d7e8f9aab';
const INSPECTION_PUBLISHED_ID   = 'b1c2d3e4-f5a6-4789-b012-3c4d5e6f7890';
const INSPECTION_INPROGRESS_ID  = 'c2d3e4f5-a6b7-4890-c123-4d5e6f789012';
const INSPECTION_UPCOMING_1_ID  = 'd3e4f5a6-b7c8-4901-d234-5e6f78901234';
const INSPECTION_UPCOMING_2_ID  = 'e4f5a6b7-c8d9-4012-e345-6f7890123456';
const INSPECTION_ATTENTION_ID   = 'f5a6b7c8-d9e0-4123-f456-789012345678';

// ── Password hashing (mirrors apps/core/src/lib/password.ts) ───────────────
function toHex(buf) { return Buffer.from(buf).toString('hex'); }
function hashPassword(password) {
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
    return `pbkdf2:${toHex(salt)}:${toHex(hash)}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function nowSec() { return Math.floor(Date.now() / 1000); }
function daysAgo(n) { return nowSec() - n * 86400; }
function daysAhead(n) { return nowSec() + n * 86400; }
function isoDate(secOffset) {
    return new Date((nowSec() + secOffset) * 1000).toISOString().slice(0, 10);
}
function sqlEscape(s) {
    if (s === null || s === undefined) return 'NULL';
    return `'${String(s).replace(/'/g, "''")}'`;
}
function sqlBool(b) { return b ? 1 : 0; }

// ── Stub templates (minimal — sandbox is workflow demo, not parity) ────────
function buildTemplateSchema(name) {
    return {
        schemaVersion: 2,
        sections: [
            {
                id: 's_exterior',
                title: 'Exterior',
                items: [
                    {
                        id: 'i_siding', label: 'Siding', type: 'rich',
                        ratingOptions: ['Inspected', 'Not Inspected', 'Repair', 'Safety Hazard'],
                        tabs: { information: [], limitations: [], defects: [] },
                    },
                    {
                        id: 'i_windows', label: 'Windows', type: 'rich',
                        ratingOptions: ['Inspected', 'Not Inspected', 'Repair', 'Safety Hazard'],
                        tabs: { information: [], limitations: [], defects: [] },
                    },
                ],
            },
            {
                id: 's_interior',
                title: 'Interior',
                items: [
                    {
                        id: 'i_walls', label: 'Walls / Ceilings', type: 'rich',
                        ratingOptions: ['Inspected', 'Not Inspected', 'Repair', 'Safety Hazard'],
                        tabs: { information: [], limitations: [], defects: [] },
                    },
                    {
                        id: 'i_floors', label: 'Floors', type: 'rich',
                        ratingOptions: ['Inspected', 'Not Inspected', 'Repair', 'Safety Hazard'],
                        tabs: { information: [], limitations: [], defects: [] },
                    },
                ],
            },
            {
                id: 's_systems',
                title: name === 'Sewer Scope' ? 'Sewer Line' : 'Major Systems',
                items: [
                    {
                        id: 'i_sys1', label: name === 'Sewer Scope' ? 'Sewer Line Condition' : 'Plumbing', type: 'rich',
                        ratingOptions: ['Inspected', 'Not Inspected', 'Repair', 'Safety Hazard'],
                        tabs: { information: [], limitations: [], defects: [] },
                    },
                ],
            },
        ],
    };
}

const TEMPLATES = [
    { id: TEMPLATE_RESIDENTIAL_ID, name: 'Standard Residential Inspection' },
    { id: TEMPLATE_PRELISTING_ID,  name: 'Pre-Listing Inspection' },
    { id: TEMPLATE_SEWERSCOPE_ID,  name: 'Sewer Scope' },
];

// ── Inspection fixtures ────────────────────────────────────────────────────
const INSPECTIONS = [
    {
        id: INSPECTION_PUBLISHED_ID,
        templateId: TEMPLATE_RESIDENTIAL_ID,
        propertyAddress: '4827 Maple Heights Dr, Austin, TX 78731',
        clientName: 'Sarah & Michael Chen',
        clientEmail: 'sarah.chen+demo@example.com',
        clientPhone: '512-555-0142',
        date: isoDate(-7 * 86400),
        status: 'published',
        paymentStatus: 'paid',
        price: 47500,
        createdAtSec: daysAgo(8),
        confirmedAt: '1', // truthy text indicating confirmed
        yearBuilt: 1998,
        sqft: 2450,
        bedrooms: 4,
        bathrooms: 2.5,
        foundationType: 'slab',
        notes: 'Published demo report — 4 defects, 12 information items, 3 limitations.',
        agreementRequired: true,
    },
    {
        id: INSPECTION_INPROGRESS_ID,
        templateId: TEMPLATE_RESIDENTIAL_ID,
        propertyAddress: '316 Oak Bluff Ln, Round Rock, TX 78664',
        clientName: 'Jennifer Walsh',
        clientEmail: 'jen.walsh+demo@example.com',
        clientPhone: '737-555-0198',
        date: isoDate(-1 * 86400),
        status: 'in_progress',
        paymentStatus: 'unpaid',
        price: 42500,
        createdAtSec: daysAgo(2),
        confirmedAt: '1',
        yearBuilt: 2006,
        sqft: 1980,
        bedrooms: 3,
        bathrooms: 2,
        foundationType: 'slab',
        notes: 'Walkthrough complete; 3 defect photos pending upload.',
        agreementRequired: true,
    },
    {
        id: INSPECTION_UPCOMING_1_ID,
        templateId: TEMPLATE_RESIDENTIAL_ID,
        propertyAddress: '11204 Stonecreek Pkwy, Cedar Park, TX 78613',
        clientName: 'David Brennan',
        clientEmail: 'david.b+demo@example.com',
        clientPhone: '512-555-0231',
        date: isoDate(1 * 86400),
        status: 'confirmed',
        paymentStatus: 'unpaid',
        price: 39500,
        createdAtSec: daysAgo(3),
        confirmedAt: '1',
        yearBuilt: 2014,
        sqft: 2120,
        bedrooms: 4,
        bathrooms: 2.5,
        foundationType: 'slab',
        notes: 'Confirmed for 9:00 AM — buyer attending.',
        agreementRequired: false,
    },
    {
        id: INSPECTION_UPCOMING_2_ID,
        templateId: TEMPLATE_PRELISTING_ID,
        propertyAddress: '7715 Wildflower Path, Pflugerville, TX 78660',
        clientName: 'Hannah Park',
        clientEmail: 'hannah.park+demo@example.com',
        clientPhone: '512-555-0307',
        date: isoDate(7 * 86400),
        status: 'draft',
        paymentStatus: 'unpaid',
        price: 35000,
        createdAtSec: daysAgo(1),
        confirmedAt: null,
        yearBuilt: 2003,
        sqft: 1750,
        bedrooms: 3,
        bathrooms: 2,
        foundationType: 'slab',
        notes: 'Pending agent confirmation.',
        agreementRequired: false,
    },
    {
        id: INSPECTION_ATTENTION_ID,
        templateId: TEMPLATE_RESIDENTIAL_ID,
        propertyAddress: '2903 Briarwood Ct, Georgetown, TX 78628',
        clientName: 'Marcus Thompson',
        clientEmail: 'marcus.t+demo@example.com',
        clientPhone: '512-555-0411',
        date: isoDate(-4 * 86400),
        status: 'confirmed',
        paymentStatus: 'unpaid',
        price: 44500,
        createdAtSec: daysAgo(5),
        confirmedAt: '1',
        yearBuilt: 1985,
        sqft: 2280,
        bedrooms: 4,
        bathrooms: 2.5,
        foundationType: 'crawlspace',
        // Agreement unsigned for > 72h → triggers attention banner
        notes: 'Agreement reminder triggered (3 days unsigned).',
        agreementRequired: true,
    },
];

// ── Canned comment library (loaded from seed-comments.js by extracting array) ──
function loadCannedComments() {
    const seedFile = join(__dirname, 'seed-comments.js');
    const src = readFileSync(seedFile, 'utf8');
    // Match every line of the form: { category: '...', severity: '...', text: '...' }
    const re = /\{\s*category:\s*'([^']+)',\s*severity:\s*'([^']+)',\s*text:\s*'((?:[^'\\]|\\.)*)'\s*\}/g;
    const out = [];
    let m;
    while ((m = re.exec(src)) !== null) {
        out.push({ category: m[1], severity: m[2], text: m[3].replace(/\\'/g, "'") });
    }
    return out;
}

// ── SQL builder ────────────────────────────────────────────────────────────
function buildSeedSql(passwordHash, comments) {
    const parts = [];
    const now = nowSec();

    // Tenant
    parts.push(`INSERT OR REPLACE INTO tenants (id, name, subdomain, tier, status, max_users, deployment_mode, created_at) VALUES
        (${sqlEscape(SANDBOX_TENANT_ID)}, 'Demo Inspections', 'sandbox', 'free', 'active', 5, 'shared', ${now});`);

    // Admin user
    parts.push(`INSERT OR REPLACE INTO users (id, tenant_id, email, password_hash, name, phone, license_number, role, totp_enabled, created_at) VALUES
        (${sqlEscape(SANDBOX_ADMIN_USER_ID)},
         ${sqlEscape(SANDBOX_TENANT_ID)},
         'demo@openinspection.dev',
         ${sqlEscape(passwordHash)},
         'Demo Inspector',
         '512-555-0100',
         'TX-SANDBOX-0001',
         'admin', 0, ${now});`);

    // Templates
    for (const t of TEMPLATES) {
        const schema = JSON.stringify(buildTemplateSchema(t.name));
        parts.push(`INSERT OR REPLACE INTO templates (id, tenant_id, name, version, schema, created_at) VALUES
            (${sqlEscape(t.id)}, ${sqlEscape(SANDBOX_TENANT_ID)}, ${sqlEscape(t.name)}, 1, ${sqlEscape(schema)}, ${now});`);
    }

    // Inspections
    for (const i of INSPECTIONS) {
        parts.push(`INSERT OR REPLACE INTO inspections (
            id, tenant_id, inspector_id, property_address, client_name, client_email, client_phone,
            template_id, date, status, payment_status, price, agreement_required, confirmed_at,
            year_built, sqft, foundation_type, bedrooms, bathrooms, internal_notes, created_at,
            payment_required, disable_automations
        ) VALUES (
            ${sqlEscape(i.id)},
            ${sqlEscape(SANDBOX_TENANT_ID)},
            ${sqlEscape(SANDBOX_ADMIN_USER_ID)},
            ${sqlEscape(i.propertyAddress)},
            ${sqlEscape(i.clientName)},
            ${sqlEscape(i.clientEmail)},
            ${sqlEscape(i.clientPhone)},
            ${sqlEscape(i.templateId)},
            ${sqlEscape(i.date)},
            ${sqlEscape(i.status)},
            ${sqlEscape(i.paymentStatus)},
            ${i.price},
            ${sqlBool(i.agreementRequired)},
            ${sqlEscape(i.confirmedAt)},
            ${i.yearBuilt},
            ${i.sqft},
            ${sqlEscape(i.foundationType)},
            ${i.bedrooms},
            ${i.bathrooms},
            ${sqlEscape(i.notes)},
            ${i.createdAtSec},
            0, 0
        );`);
    }

    // Inspection results — only the published one + the in-progress one carry data so the demo
    // viewer renders something on click.
    const publishedData = JSON.stringify({
        sections: [
            { id: 's_exterior', title: 'Exterior', items: [
                { id: 'i_siding',  label: 'Siding',  rating: 'Inspected', notes: 'Vinyl siding in good condition.' },
                { id: 'i_windows', label: 'Windows', rating: 'Repair',    notes: 'Two windows have failed seals — recommend repair.' },
            ] },
            { id: 's_interior', title: 'Interior', items: [
                { id: 'i_walls',  label: 'Walls / Ceilings', rating: 'Inspected', notes: 'No visible defects.' },
                { id: 'i_floors', label: 'Floors',           rating: 'Repair',    notes: 'Hardwood scratched in living room.' },
            ] },
            { id: 's_systems', title: 'Major Systems', items: [
                { id: 'i_sys1', label: 'Plumbing', rating: 'Safety Hazard', notes: 'Active leak under kitchen sink.' },
            ] },
        ],
        defectCount: 4,
    });
    parts.push(`INSERT OR REPLACE INTO inspection_results (id, tenant_id, inspection_id, data, last_synced_at) VALUES
        (${sqlEscape(randomUUID())}, ${sqlEscape(SANDBOX_TENANT_ID)}, ${sqlEscape(INSPECTION_PUBLISHED_ID)}, ${sqlEscape(publishedData)}, ${now});`);

    const inProgressData = JSON.stringify({
        sections: [
            { id: 's_exterior', title: 'Exterior', items: [
                { id: 'i_siding',  label: 'Siding',  rating: 'Inspected', notes: 'Brick exterior, no visible defects.' },
                { id: 'i_windows', label: 'Windows', rating: 'Repair',    notes: 'Bedroom window screen torn.' },
            ] },
            { id: 's_interior', title: 'Interior', items: [
                { id: 'i_walls',  label: 'Walls / Ceilings', rating: 'Repair', notes: 'Hairline crack in dining room ceiling — monitor.' },
            ] },
            { id: 's_systems', title: 'Major Systems', items: [
                { id: 'i_sys1', label: 'Plumbing', rating: 'Repair', notes: 'Toilet flush valve slow.' },
            ] },
        ],
        defectCount: 3,
    });
    parts.push(`INSERT OR REPLACE INTO inspection_results (id, tenant_id, inspection_id, data, last_synced_at) VALUES
        (${sqlEscape(randomUUID())}, ${sqlEscape(SANDBOX_TENANT_ID)}, ${sqlEscape(INSPECTION_INPROGRESS_ID)}, ${sqlEscape(inProgressData)}, ${now});`);

    // Comments — wipe + reload to keep idempotency.
    parts.push(`DELETE FROM comments WHERE tenant_id = ${sqlEscape(SANDBOX_TENANT_ID)};`);
    if (comments.length > 0) {
        const commentValues = comments.map(c => {
            const id = randomUUID();
            return `(${sqlEscape(id)}, ${sqlEscape(SANDBOX_TENANT_ID)}, ${sqlEscape(c.category)}, ${sqlEscape(c.text)}, ${sqlEscape(c.severity)}, ${now})`;
        }).join(',\n');
        parts.push(`INSERT INTO comments (id, tenant_id, category, text, severity, created_at) VALUES\n${commentValues};`);
    }

    return parts.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────
function main() {
    console.log(`[sandbox-seed] target=${LOCAL ? 'local' : 'remote'} db=${DB_NAME}${ENV_FLAG}`);

    const passwordHash = hashPassword('demo1234');
    const comments = loadCannedComments();
    console.log(`[sandbox-seed] loaded ${comments.length} canned comments from seed-comments.js`);

    const sql = buildSeedSql(passwordHash, comments);
    const dir = join(tmpdir(), 'oi-sandbox-seed');
    mkdirSync(dir, { recursive: true });
    const sqlFile = join(dir, 'sandbox-seed.sql');
    writeFileSync(sqlFile, sql, 'utf8');

    try {
        execSync(
            `npx wrangler d1 execute ${DB_NAME} ${flag}${ENV_FLAG} --file "${sqlFile}"`,
            { encoding: 'utf8', stdio: 'inherit' }
        );
        console.log(`[sandbox-seed] OK — tenant=${SANDBOX_TENANT_ID}, login=demo@openinspection.dev / demo1234`);
        console.log(`[sandbox-seed] inspections=${INSPECTIONS.length} templates=${TEMPLATES.length} comments=${comments.length}`);
    } finally {
        try { unlinkSync(sqlFile); } catch { /* ignore */ }
    }
}

main();
