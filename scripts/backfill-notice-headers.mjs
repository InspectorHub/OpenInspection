#!/usr/bin/env node
/**
 * Communication C1 (design §3.13) — one-time notice-header backfill.
 *
 * Rows in `automation_logs` written before C1 have no header: their recipient
 * cannot see them in a Notices inbox and the Outbox groups them by the
 * interim (automation_id, send_at) key. This script creates one
 * `notifications` header per (automation_id, inspection_id, send_at,
 * recipient) group and stamps `notice_id` on the group's rows.
 *
 * Recipient mapping mirrors the live path (trigger.ts):
 *   - recipient_role_key = 'inspector'  -> header user_id  (the resolver
 *     stuffs the user id into recipient_contact_id for staff)
 *   - anything else with a contact id   -> header contact_id
 *   - no contact id at all              -> SKIPPED (notice_id stays NULL and
 *     the Outbox fallback grouping keeps covering the row)
 *
 * Header titles are synthesized from the automation name (or 'Manual send') —
 * the same hardcoded-English debt as titleFor (IA-115); Track B templates it.
 *
 * DRY RUN by default; --apply writes; --remote targets remote D1 — read
 * docs/saas-ops/d1-migration-sop.md FIRST and take a backup + time-travel
 * bookmark before applying remotely.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const REMOTE = process.argv.includes('--remote');
const APPLY = process.argv.includes('--apply');

const cfg =
  process.env.WRANGLER_CONFIG ||
  (existsSync('wrangler.local.jsonc') ? 'wrangler.local.jsonc' : 'wrangler.jsonc');

const q = (s) => '"' + String(s).replace(/"/g, '\\"') + '"';

function d1(command, { json = true } = {}) {
  const cmd = [
    'npx', 'wrangler', 'd1', 'execute', 'DB',
    REMOTE ? '--remote' : '--local',
    '--command', q(command),
    '-c', cfg,
    ...(json ? ['--json'] : []),
  ].join(' ');
  const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!json) return out;
  return JSON.parse(out).flatMap((s) => s.results ?? []);
}

const sq = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const rows = d1(
  'SELECT l.id, l.tenant_id, l.automation_id, l.inspection_id, l.send_at, ' +
  'l.recipient_contact_id, l.recipient_role_key, a.name AS automation_name, a.trigger AS trigger_event ' +
  'FROM automation_logs l LEFT JOIN automations a ON a.id = l.automation_id ' +
  'WHERE l.notice_id IS NULL AND l.recipient_contact_id IS NOT NULL',
);

// Group by (automation_id, inspection_id, send_at, recipient side+id).
const groups = new Map();
for (const r of rows) {
  const isStaff = r.recipient_role_key === 'inspector';
  const key = [r.automation_id ?? '', r.inspection_id, r.send_at, isStaff ? 'u' : 'c', r.recipient_contact_id].join('|');
  const g = groups.get(key) ?? {
    tenantId: r.tenant_id,
    inspectionId: r.inspection_id,
    userId: isStaff ? r.recipient_contact_id : null,
    contactId: isStaff ? null : r.recipient_contact_id,
    type: r.automation_id == null ? 'manual.send' : (r.trigger_event ?? 'notice'),
    title: r.automation_id == null ? 'Manual send' : (r.automation_name ?? 'Notice'),
    createdAtMs: Number(r.send_at),
    logIds: [],
  };
  g.logIds.push(r.id);
  groups.set(key, g);
}

// `notifications.user_id` carries a frozen legacy FK to `users` — a staff
// header for a since-deleted user would violate it. Pre-check existence and
// skip those groups (their rows stay on the fallback grouping). `contact_id`
// has no FK (added post-freeze per Schema Rules), so no check there.
const staffIds = [...new Set([...groups.values()].filter((g) => g.userId).map((g) => g.userId))];
if (staffIds.length > 0) {
  const found = new Set(
    d1(`SELECT id FROM users WHERE id IN (${staffIds.map(sq).join(', ')})`).map((r) => String(r.id)),
  );
  let dropped = 0;
  for (const [key, g] of [...groups.entries()]) {
    if (g.userId && !found.has(g.userId)) { groups.delete(key); dropped++; }
  }
  if (dropped > 0) console.log(`${dropped} staff group(s) skipped — user no longer exists (rows stay on fallback grouping).`);
}

console.log(`${rows.length} unstamped log rows scanned -> ${groups.size} headers to create.`);
let skippedNoRecipient = 0;
const skipped = d1(
  'SELECT COUNT(*) AS n FROM automation_logs WHERE notice_id IS NULL AND recipient_contact_id IS NULL',
);
skippedNoRecipient = Number(skipped[0]?.n ?? 0);
if (skippedNoRecipient > 0) {
  console.log(`${skippedNoRecipient} rows have no recipient id and stay on the fallback grouping (not covered).`);
}

if (groups.size === 0) process.exit(0);
if (!APPLY) {
  for (const g of [...groups.values()].slice(0, 10)) {
    console.log(`  ${g.contactId ? 'contact ' + g.contactId : 'user ' + g.userId}: "${g.title}" x${g.logIds.length} rows (inspection ${g.inspectionId})`);
  }
  if (groups.size > 10) console.log(`  … and ${groups.size - 10} more.`);
  console.log('\nDry run — nothing written. Re-run with --apply to write.' + (REMOTE ? ' (REMOTE: back up per docs/saas-ops/d1-migration-sop.md first.)' : ''));
  process.exit(0);
}

const BATCH = 20;
const entries = [...groups.values()];
for (let i = 0; i < entries.length; i += BATCH) {
  const stmts = [];
  for (const g of entries.slice(i, i + BATCH)) {
    const noticeId = randomUUID();
    stmts.push(
      'INSERT INTO notifications (id, tenant_id, user_id, contact_id, type, title, body, entity_type, entity_id, inspection_id, metadata, read_at, archived_at, created_at) VALUES (' +
      [sq(noticeId), sq(g.tenantId), g.userId ? sq(g.userId) : 'NULL', g.contactId ? sq(g.contactId) : 'NULL',
       sq(g.type), sq(g.title), 'NULL', sq('inspection'), sq(g.inspectionId), sq(g.inspectionId),
       'NULL', 'NULL', 'NULL', String(g.createdAtMs)].join(', ') + ')',
    );
    stmts.push(
      `UPDATE automation_logs SET notice_id = ${sq(noticeId)} WHERE id IN (${g.logIds.map(sq).join(', ')})`,
    );
  }
  d1(stmts.join('; '), { json: false });
}
console.log(`Created ${entries.length} headers and stamped their rows.`);
