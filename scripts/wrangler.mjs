#!/usr/bin/env node
/**
 * Thin wrangler wrapper that resolves which config to use, matching the logic in
 * vite.config.ts so direct wrangler commands (db:migrate, etc.) stay consistent
 * with the build:
 *   WRANGLER_CONFIG env wins (e.g. saas)  ->
 *   else wrangler.local.jsonc if present (real ids) ->
 *   else committed wrangler.jsonc (placeholders / one-click).
 *
 *   node scripts/wrangler.mjs d1 migrations apply DB --local
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const cfg =
  process.env.WRANGLER_CONFIG ||
  (existsSync('wrangler.local.jsonc') ? 'wrangler.local.jsonc' : 'wrangler.jsonc');

const args = process.argv.slice(2);
const r = spawnSync('npx', ['wrangler', ...args, '-c', cfg], { stdio: 'inherit', shell: true });
process.exit(r.status ?? 0);
