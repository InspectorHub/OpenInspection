#!/usr/bin/env node
/**
 * Sprint 2 S2-1 — Seeds the four canonical rating systems for a tenant.
 *
 * Run:
 *      TENANT_ID=<uuid> node scripts/seed-rating-systems.js          # standalone prod (--remote)
 *      TENANT_ID=<uuid> node scripts/seed-rating-systems.js --local  # local dev
 *      TENANT_ID=<uuid> node scripts/seed-rating-systems.js --saas   # saas prod
 *
 * Idempotent: skips any system whose (tenant_id, slug) pair already exists.
 *
 * SEEDS duplicated from src/data/rating-system-seeds.ts — keep in sync with
 * the runtime service-layer seeder. Both paths normalize the level list so
 * any caller can rely on UUID + display order being filled in.
 */
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TENANT_ID = process.env.TENANT_ID || 'standalone';
const DB_NAME   = process.env.DB_NAME   || 'DB';
const LOCAL = process.argv.includes('--local');
const SAAS  = process.argv.includes('--saas');
// `--config <path>` mirrors seed-marketplace.js; takes precedence over --saas.
const configIdx = process.argv.indexOf('--config');
const configPath = configIdx > -1 ? process.argv[configIdx + 1] : (SAAS ? 'wrangler.saas.toml' : '');

const flag       = LOCAL ? '--local' : '--remote';
const configFlag = configPath ? `-c ${configPath}` : '';

// ── Seed data — mirror of src/data/rating-system-seeds.ts ─────────────────
const SEEDS = [
    {
        slug:        'oi-4tier',
        name:        'OpenInspection Default (4-tier)',
        description: 'Standard four-tier rating used in most residential inspections.',
        isDefault:   true,
        levels: [
            { abbr: 'Sat', label: 'Satisfactory',  color: '#10b981', bucket: 'satisfactory', hotkey: '1' },
            { abbr: 'Mon', label: 'Monitor',       color: '#f59e0b', bucket: 'monitor',      hotkey: '2' },
            { abbr: 'D',   label: 'Defect',        color: '#ef4444', bucket: 'defect',       hotkey: '3' },
            { abbr: 'NI',  label: 'Not Inspected', color: '#94a3b8', bucket: 'na',           hotkey: '4' },
            { abbr: 'NP',  label: 'Not Present',   color: '#cbd5e1', bucket: 'na',           hotkey: '5' },
        ],
    },
    {
        slug:        'trec',
        name:        'TREC (Texas REC 4-level)',
        description: 'Texas Real Estate Commission standard: Inspected / Not Inspected / Not Present / Deficient.',
        isDefault:   false,
        levels: [
            { abbr: 'I',  label: 'Inspected',     color: '#10b981', bucket: 'satisfactory', hotkey: '1' },
            { abbr: 'NI', label: 'Not Inspected', color: '#94a3b8', bucket: 'na',           hotkey: '2' },
            { abbr: 'NP', label: 'Not Present',   color: '#cbd5e1', bucket: 'na',           hotkey: '3' },
            { abbr: 'D',  label: 'Deficient',     color: '#ef4444', bucket: 'defect',       hotkey: '4' },
        ],
    },
    {
        slug:        'itb',
        name:        'Inspector Toolbelt (ITB) 8-level',
        description: 'Inspector Toolbelt full granularity scheme — finer severity tracking for detailed reports.',
        isDefault:   false,
        levels: [
            { abbr: 'F',   label: 'Functional',      color: '#10b981', bucket: 'satisfactory', hotkey: '1' },
            { abbr: 'LM',  label: 'Low Maintenance', color: '#34d399', bucket: 'satisfactory', hotkey: '2' },
            { abbr: 'Mon', label: 'Monitor',         color: '#fbbf24', bucket: 'monitor',      hotkey: '3' },
            { abbr: 'Mar', label: 'Marginal',        color: '#f59e0b', bucket: 'monitor',      hotkey: '4' },
            { abbr: 'D',   label: 'Deficiency',      color: '#ef4444', bucket: 'defect',       hotkey: '5' },
            { abbr: 'H',   label: 'Hazard',          color: '#dc2626', bucket: 'defect',       hotkey: '6' },
            { abbr: 'NP',  label: 'Not Present',     color: '#cbd5e1', bucket: 'na',           hotkey: '7' },
            { abbr: 'NI',  label: 'Not Inspected',   color: '#94a3b8', bucket: 'na',           hotkey: '8' },
        ],
    },
    {
        slug:        'itb-3',
        name:        'Inspector Toolbelt (ITB) 3-tier',
        description: 'Inspector Toolbelt simplified scheme — Functional / Marginal / Deficient. Fast for screening visits.',
        isDefault:   false,
        levels: [
            { abbr: 'F',   label: 'Functional', color: '#10b981', bucket: 'satisfactory', hotkey: '1' },
            { abbr: 'Mar', label: 'Marginal',   color: '#f59e0b', bucket: 'monitor',      hotkey: '2' },
            { abbr: 'D',   label: 'Deficient',  color: '#ef4444', bucket: 'defect',       hotkey: '3' },
        ],
    },
];

const escapeSql = (s) => String(s).replace(/'/g, "''");

const nowMs = Date.now();

const values = SEEDS.map((s) => {
    const id = randomUUID();
    const levels = s.levels.map((lvl, idx) => ({
        id: randomUUID(),
        abbr: lvl.abbr,
        label: lvl.label,
        color: lvl.color,
        bucket: lvl.bucket,
        ...(lvl.hotkey ? { hotkey: lvl.hotkey } : {}),
        order: idx,
    }));
    const levelsJson = escapeSql(JSON.stringify(levels));
    return `('${id}', '${TENANT_ID}', '${escapeSql(s.name)}', '${s.slug}', '${escapeSql(s.description)}', '${levelsJson}', ${s.isDefault ? 1 : 0}, 1, ${nowMs}, ${nowMs})`;
}).join(',\n');

// Use INSERT OR IGNORE so re-runs don't crash on the (tenant_id, slug) unique
// index — they just become a no-op for the slugs that already exist.
const sql = `INSERT OR IGNORE INTO rating_systems (id, tenant_id, name, slug, description, levels, is_default, is_seed, created_at, updated_at) VALUES\n${values};`;

const tmpDir  = join(tmpdir(), 'oi-seed-rating-systems');
mkdirSync(tmpDir, { recursive: true });
const sqlFile = join(tmpDir, 'rating-systems.sql');
writeFileSync(sqlFile, sql, 'utf8');

try {
    execSync(
        `npx wrangler d1 execute ${DB_NAME} ${flag} ${configFlag} --file "${sqlFile}"`,
        { encoding: 'utf8', stdio: 'inherit' },
    );
    console.log(`Seeded ${SEEDS.length} rating systems for tenant '${TENANT_ID}'.`);
} catch (e) {
    console.error('Seed insert failed:', e.message);
    process.exit(1);
}
