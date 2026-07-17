#!/usr/bin/env node
/**
 * i18n — catalog drift gate (`lint:i18n-catalog`).
 *
 * The English catalog is the source of truth. Since Rollout 5 the catalog is
 * split per module: `messages/<locale>/<module>.json` (auth, common, …), matching
 * `project.inlang/settings.json`'s `pathPattern` array. Paraglide merges every
 * module into ONE flat `m.*` namespace, so this gate merges the same way.
 *
 * Every source key MUST either have a non-empty `es-419` translation OR be
 * explicitly listed in FALLBACK_ALLOW below (a key we knowingly ship in English
 * until translated — it falls back to English at runtime, which is safe but must
 * be a *deliberate* choice, never silent drift). Also flags STALE target keys and
 * DUPLICATE keys across modules (a real conflict in the shared namespace).
 *
 * As phases 3-5 extract more surfaces, add newly-extracted-but-untranslated keys
 * to FALLBACK_ALLOW, then remove each as its es-419 translation lands.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_LOCALE = 'en';
const TARGET_LOCALES = ['es-419'];

/**
 * Keys deliberately shipped English-only for now (fall back at runtime).
 * Keep this list EMPTY except while a surface is mid-migration. Format: exact
 * message keys, e.g. 'inspections_list_emptyState'.
 * @type {string[]}
 */
const FALLBACK_ALLOW = [];

let failed = false;

/**
 * Merge every `messages/<locale>/*.json` module into one flat key→value map,
 * mirroring how Paraglide compiles the shared namespace. A key defined in two
 * modules is a conflict (the last one silently wins at compile time) — fail loudly.
 */
function load(locale) {
  const dir = join(root, 'messages', locale);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const merged = {};
  for (const file of files) {
    const { $schema, ...messages } = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const [key, value] of Object.entries(messages)) {
      if (Object.prototype.hasOwnProperty.call(merged, key)) {
        console.error(`[i18n-catalog] ${locale}: duplicate key '${key}' across modules (conflicts in the shared m.* namespace).`);
        failed = true;
      }
      merged[key] = value;
    }
  }
  return merged;
}

const source = load(SOURCE_LOCALE);
const sourceKeys = Object.keys(source);
const allow = new Set(FALLBACK_ALLOW);

// Guard: the `common_` prefix is RESERVED for messages/<locale>/common.json.
// Generic action words (Cancel/Save/Delete/…) live there once and are reused
// everywhere as m.common_*(); a surface module minting its own generic key (the
// parallel-extraction duplicate hazard) is a CI failure. Enforced on the source
// locale's per-file layout.
{
  const dir = join(root, 'messages', SOURCE_LOCALE);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const { $schema, ...messages } = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const isCommon = file === 'common.json';
    for (const key of Object.keys(messages)) {
      if (key.startsWith('common_') && !isCommon) {
        console.error(`[i18n-catalog] ${file}: key '${key}' uses the reserved 'common_' prefix — generic keys must live in common.json.`);
        failed = true;
      }
      if (!key.startsWith('common_') && isCommon) {
        console.error(`[i18n-catalog] common.json: key '${key}' is not 'common_'-prefixed — common.json holds only shared generic keys.`);
        failed = true;
      }
    }
  }
}

// Guard 1: unknown allow-list entries (a key was translated or renamed but left
// in FALLBACK_ALLOW) — keep the list honest.
for (const k of allow) {
  if (!sourceKeys.includes(k)) {
    console.error(`[i18n-catalog] FALLBACK_ALLOW lists '${k}', which is not a key in messages/${SOURCE_LOCALE}/*.json — remove it.`);
    failed = true;
  }
}

const coverage = [];
for (const locale of TARGET_LOCALES) {
  const target = load(locale);
  const targetKeys = new Set(Object.keys(target));

  // English-only extraction phase: a target translation is OPTIONAL. Keys without
  // one fall back to English at runtime (safe). We only REPORT coverage here — we
  // do NOT fail on untranslated keys, so the extraction sweep can add English keys
  // without blocking on translation. (The parity hard-gate returns in the
  // translation phase; FALLBACK_ALLOW / `allow` is retained for that.)
  const translated = sourceKeys.filter(
    (k) => targetKeys.has(k) && String(target[k]).trim() !== '',
  ).length;
  coverage.push(`${locale} ${translated}/${sourceKeys.length}`);

  // Guard: any PRESENT translation must be non-empty (an empty string is a
  // mistake — it renders blank instead of falling back to English).
  const blank = [...targetKeys].filter((k) => String(target[k]).trim() === '');
  if (blank.length) {
    failed = true;
    console.error(
      `[i18n-catalog] ${locale}: ${blank.length} key(s) present but EMPTY (delete the key to fall back to English, or translate it):\n` +
        blank.map((k) => `    - ${k}`).join('\n'),
    );
  }

  // Guard: no stale target keys absent from the source (typos / leftovers).
  const stale = [...targetKeys].filter((k) => !sourceKeys.includes(k));
  if (stale.length) {
    failed = true;
    console.error(
      `[i18n-catalog] ${locale}: ${stale.length} stale key(s) not present in messages/${SOURCE_LOCALE}/*.json:\n` +
        stale.map((k) => `    - ${k}`).join('\n'),
    );
  }
}

if (failed) {
  console.error('[i18n-catalog] FAIL — resolve the catalog drift above.');
  process.exit(1);
}
console.log(`[i18n-catalog] OK (English-only phase) — ${sourceKeys.length} source key(s); translation coverage: ${coverage.join(', ')}.`);
