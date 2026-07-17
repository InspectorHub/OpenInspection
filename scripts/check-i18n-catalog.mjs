#!/usr/bin/env node
/**
 * i18n Phase C — catalog drift gate (`lint:i18n-catalog`).
 *
 * The English catalog (`messages/en.json`) is the source of truth. Every source
 * key MUST either have a non-empty `es-419` translation OR be explicitly listed
 * in FALLBACK_ALLOW below (a key we knowingly ship in English until translated —
 * it falls back to English at runtime, which is safe but must be a *deliberate*
 * choice, never silent drift). This is the guard the Phase C design §7 calls for.
 *
 * Also flags STALE target keys (present in es-419 but not in en) — typos / leftovers.
 *
 * As phases 3-5 extract more surfaces, add newly-extracted-but-untranslated keys
 * to FALLBACK_ALLOW, then remove each as its es-419 translation lands.
 */
import { readFileSync } from 'node:fs';
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

function load(locale) {
  const raw = JSON.parse(readFileSync(join(root, 'messages', `${locale}.json`), 'utf8'));
  // Drop the JSON-schema pointer; everything else is a message key.
  const { $schema, ...messages } = raw;
  return messages;
}

const source = load(SOURCE_LOCALE);
const sourceKeys = Object.keys(source);
const allow = new Set(FALLBACK_ALLOW);
let failed = false;

// Guard 1: unknown allow-list entries (a key was translated or renamed but left
// in FALLBACK_ALLOW) — keep the list honest.
for (const k of allow) {
  if (!sourceKeys.includes(k)) {
    console.error(`[i18n-catalog] FALLBACK_ALLOW lists '${k}', which is not a key in messages/${SOURCE_LOCALE}.json — remove it.`);
    failed = true;
  }
}

for (const locale of TARGET_LOCALES) {
  const target = load(locale);
  const targetKeys = new Set(Object.keys(target));

  // Guard 2: every source key is translated OR explicitly allow-listed.
  const missing = sourceKeys.filter(
    (k) => !allow.has(k) && (!targetKeys.has(k) || String(target[k]).trim() === ''),
  );
  if (missing.length) {
    failed = true;
    console.error(
      `[i18n-catalog] ${locale}: ${missing.length} source key(s) missing a translation and not in FALLBACK_ALLOW:\n` +
        missing.map((k) => `    - ${k}`).join('\n'),
    );
  }

  // Guard 3: no stale target keys absent from the source.
  const stale = [...targetKeys].filter((k) => !sourceKeys.includes(k));
  if (stale.length) {
    failed = true;
    console.error(
      `[i18n-catalog] ${locale}: ${stale.length} stale key(s) not present in messages/${SOURCE_LOCALE}.json:\n` +
        stale.map((k) => `    - ${k}`).join('\n'),
    );
  }
}

if (failed) {
  console.error('[i18n-catalog] FAIL — resolve the catalog drift above.');
  process.exit(1);
}
console.log(`[i18n-catalog] OK — ${sourceKeys.length} source key(s); ${TARGET_LOCALES.join(', ')} in parity (${allow.size} allow-listed fallback).`);
