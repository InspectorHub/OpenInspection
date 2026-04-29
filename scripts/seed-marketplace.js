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

let count = 0;
try {
  const result = execSync(
    `npx wrangler d1 execute ${DB_NAME} ${flag} --json --command "SELECT COUNT(*) as c FROM marketplace_templates"`,
    { encoding: 'utf8' }
  );
  const jsonStart = result.indexOf('[');
  if (jsonStart >= 0) {
    count = JSON.parse(result.slice(jsonStart))?.[0]?.results?.[0]?.c ?? 0;
  }
} catch { /* fallback */ }

if (count >= 3) {
  console.log(`Seed skipped: ${count} marketplace templates already exist.`);
  process.exit(0);
}

const SEED_DIR = join(__dirname, '../src/data/seed-templates');

const TEMPLATES = [
  { file: 'residential.json', name: 'Standard Residential Inspection', category: 'residential', changelog: 'Initial release: standard US residential home inspection template.' },
  { file: 'trec-rei-7-6.json', name: 'TREC REI 7-6 Inspection Report', category: 'trec', changelog: 'Initial release: Texas Real Estate Commission REI 7-6 compliant template.' },
  { file: 'commercial.json', name: 'Commercial Property Inspection', category: 'commercial', changelog: 'Initial release: light commercial property inspection template.' },
];

const now = new Date().toISOString();

const tmpDir = join(tmpdir(), 'oi-seed-marketplace');
mkdirSync(tmpDir, { recursive: true });

for (const t of TEMPLATES) {
  const schema = readFileSync(join(SEED_DIR, t.file), 'utf8');
  const id = randomUUID();
  const safeChangelog = t.changelog.replace(/'/g, "''");
  const safeName = t.name.replace(/'/g, "''");
  const safeSchema = schema.replace(/'/g, "''");

  const sql = `INSERT OR IGNORE INTO marketplace_templates (id, name, category, semver, schema, author_id, changelog, download_count, created_at, updated_at) VALUES ('${id}', '${safeName}', '${t.category}', '1.0.0', '${safeSchema}', 'system', '${safeChangelog}', 0, '${now}', '${now}');`;

  const sqlFile = join(tmpDir, `${t.category}.sql`);
  writeFileSync(sqlFile, sql, 'utf8');

  try {
    execSync(
      `npx wrangler d1 execute ${DB_NAME} ${flag} --file "${sqlFile}"`,
      { encoding: 'utf8', stdio: 'inherit' }
    );
    console.log(`  Seeded: ${t.name}`);
  } finally {
    try { unlinkSync(sqlFile); } catch { /* ignore */ }
  }
}

console.log('Marketplace seed complete.');
