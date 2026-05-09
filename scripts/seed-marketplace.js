#!/usr/bin/env node
/**
 * Seeds the marketplace_templates table with 3 community templates.
 * Run: npm run seed:marketplace
 * Idempotent: skips if marketplace already has templates.
 * Schema: migrations/0018_marketplace.sql
 *
 * Uses --file with a temp SQL file to avoid shell-arg-length limits
 * when template schemas are large.
 */
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_NAME = process.env.DB_NAME || 'DB';
const LOCAL = process.argv.includes('--local');
const flag = LOCAL ? '--local' : '--remote';
// Polish 5 — support targeting saas (or any wrangler.*.toml) via --config flag
const configIdx = process.argv.indexOf('--config');
const CONFIG = configIdx > -1 ? `-c ${process.argv[configIdx + 1]}` : '';

let count = 0;
try {
  const result = execSync(
    `npx wrangler d1 execute ${DB_NAME} ${flag} ${CONFIG} --json --command "SELECT COUNT(*) as c FROM marketplace_templates"`,
    { encoding: 'utf8' }
  );
  const jsonStart = result.indexOf('[');
  if (jsonStart >= 0) {
    count = JSON.parse(result.slice(jsonStart))?.[0]?.results?.[0]?.c ?? 0;
  }
} catch { /* fallback */ }

const SEED_DIR = join(__dirname, '../src/data/seed-templates');

// Spec 4F — `featured: 1` flags Spectora-parity defaults for marketplace top-sort + auto-seed on tenant init.
// S3-5 — `internachi-13.json` is a standards-aligned 13-section template covering the InterNACHI Standards of Practice. Featured under category `standards_aligned`.
const TEMPLATES = [
  { file: 'internachi-13.json',     name: 'InterNACHI 13-Section Standard',          category: 'standards_aligned', featured: 1, changelog: 'S3-5: Standards-aligned 13-section template covering the InterNACHI Standards of Practice. Each section ships with a built-in legal disclaimer.' },
  { file: 'residential.json',       name: 'Standard Residential Inspection',         category: 'residential',       featured: 1, changelog: 'Initial release: standard US residential home inspection template.' },
  { file: 'pre-listing.json',       name: 'Pre-Listing Inspection',                  category: 'residential',       featured: 1, changelog: 'Spec 4F: seller-focused pre-listing inspection.' },
  { file: 'trec-rei-7-6.json',      name: 'TREC REI 7-6 Inspection Report',          category: 'trec',              featured: 0, changelog: 'Initial release: Texas Real Estate Commission REI 7-6 compliant template.' },
  { file: 'commercial.json',        name: 'Commercial Property Inspection',          category: 'commercial',        featured: 0, changelog: 'Initial release: light commercial property inspection template.' },
  { file: 'condo.json',             name: 'Condominium Inspection',                  category: 'condo',             featured: 0, changelog: 'Initial release: condo unit-focused inspection (HOA boundary aware).' },
  { file: 'new-construction.json',       name: 'New Construction Pre-Drywall Inspection', category: 'new_construction',  featured: 1, changelog: 'Initial release: pre-drywall mid-build inspection (framing/plumbing/electrical/envelope).' },
  { file: 'new-construction-final.json', name: 'New Construction Final Walkthrough',      category: 'new_construction',  featured: 1, changelog: 'Spec 4F polish: pre-closing finishes + commissioning + punch list compilation.' },
  { file: 'wind-mitigation.json',   name: 'Wind Mitigation Survey',                  category: 'residential',       featured: 0, changelog: 'Initial release: Florida-style Uniform Mitigation Verification (OIR-B1-1802).' },
  { file: 'septic.json',            name: 'Septic System Inspection',                category: 'residential',       featured: 0, changelog: 'Initial release: septic tank, distribution, and drain field add-on.' },
  { file: 'sewer-scope.json',       name: 'Sewer Scope Inspection',                  category: 'residential',       featured: 1, changelog: 'Spec 4F: camera inspection of main sewer line.' },
  { file: 'radon.json',             name: 'Radon Measurement Report',                category: 'residential',       featured: 1, changelog: 'Initial release: short-term radon test protocol with EPA 4.0 pCi/L threshold check.' },
  { file: 'mold-inspection.json',   name: 'Mold Inspection',                         category: 'residential',       featured: 1, changelog: 'Spec 4F: visual mold inspection + moisture mapping.' },
];

// Spec 4F polish: when count matches but featured flags need backfill, allow --force to proceed.
const FORCE = process.argv.includes('--force');
if (count >= TEMPLATES.length && !FORCE) {
  console.log(`Seed skipped: ${count} marketplace templates already exist (target ${TEMPLATES.length}). Pass --force to re-run UPDATE statements (e.g., to backfill featured flags).`);
  process.exit(0);
}

const now = new Date().toISOString();

const tmpDir = join(tmpdir(), 'oi-seed-marketplace');
mkdirSync(tmpDir, { recursive: true });

for (const t of TEMPLATES) {
  // Spec 1 fix: the seed JSON file is shaped {id, name, description, version, schema: {sections}}.
  // We must store ONLY the inner .schema (i.e. {sections: ...}) in marketplace_templates.schema,
  // not the entire file. Otherwise importTemplate copies the wrong shape into templates.schema
  // and the form-renderer can't find sections at templates.schema.sections.
  const fileContent = JSON.parse(readFileSync(join(SEED_DIR, t.file), 'utf8'));
  if (!fileContent.schema || !Array.isArray(fileContent.schema.sections)) {
    console.error(`Seed file ${t.file} missing schema.sections; skipping.`);
    continue;
  }
  const schema = JSON.stringify(fileContent.schema);
  const id = randomUUID();
  const safeChangelog = t.changelog.replace(/'/g, "''");
  const safeName = t.name.replace(/'/g, "''");
  const safeSchema = schema.replace(/'/g, "''");

  // De-dupe by name (not id) since id is regenerated on every run. Without
  // this guard, re-running after adding new templates would duplicate the
  // already-seeded ones.
  const featured = t.featured ? 1 : 0;
  // Two-statement script: insert if missing, then ensure featured flag is set correctly (idempotent).
  const sql = `INSERT INTO marketplace_templates (id, name, category, semver, schema, author_id, changelog, download_count, featured, created_at, updated_at) SELECT '${id}', '${safeName}', '${t.category}', '1.0.0', '${safeSchema}', 'system', '${safeChangelog}', 0, ${featured}, '${now}', '${now}' WHERE NOT EXISTS (SELECT 1 FROM marketplace_templates WHERE name = '${safeName}'); UPDATE marketplace_templates SET featured = ${featured} WHERE name = '${safeName}';`;

  const sqlFile = join(tmpDir, `${t.category}.sql`);
  writeFileSync(sqlFile, sql, 'utf8');

  try {
    execSync(
      `npx wrangler d1 execute ${DB_NAME} ${flag} ${CONFIG} --file "${sqlFile}"`,
      { encoding: 'utf8', stdio: 'inherit' }
    );
    console.log(`  Seeded: ${t.name}`);
  } finally {
    try { unlinkSync(sqlFile); } catch { /* ignore */ }
  }
}

console.log('Marketplace seed complete.');
