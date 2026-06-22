#!/usr/bin/env node
/**
 * Tenant-scoping anti-drift gate.
 *
 * Fails (exit 1) when server/services/** or server/api/** contains a raw-drizzle
 * `.where(` call that references `<tenantScopedTable>.id` (via `eq(table.id, ...)`)
 * WITHOUT also referencing a `tenantId` or `tenant_id` token in the same
 * balanced `.where(...)` expression.
 *
 * Why: unscoped by-id queries on tenant-scoped tables are cross-tenant data-
 * leak vectors — a crafted id for another tenant's row bypasses isolation.
 * Tasks 1-4 of #183 fixed the known offenders; this gate prevents new ones.
 *
 * Tenant-scoped table identifiers are derived at runtime by scanning the schema
 * source for `sqliteTable('name', {...})` declarations whose body contains a
 * `tenant_id` column — same approach as `scoped-tables.ts` but in plain JS.
 * `users` is intentionally excluded: every user-row access is self-referential
 * (authenticated JWT `sub`), never a cross-tenant id-guess vector.
 *
 * Escape hatch: add the `file:line` key to ALLOW below with a one-line comment
 * explaining WHY (audited safe). ALLOW entries warn (exit 0); new un-allowed
 * hits hard-fail (exit 1).
 *
 * console.* is intentional — this is a build script, not server code (no-console
 * rule is server-only).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export { findUnscopedByIdQueries };

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SCHEMA_DIR = join(ROOT, "server", "lib", "db", "schema");
const SCAN_DIRS = [
  join(ROOT, "server", "services"),
  join(ROOT, "server", "api"),
];

// ---------------------------------------------------------------------------
// ALLOW list — audited exceptions (exit 0 with a warning, not exit 1).
// Key format: "relative/path/to/file.ts:LINE"  (1-based line number of the
// `.where(` token that opens the expression window).
// ---------------------------------------------------------------------------
const ALLOW = new Map([
  // post-insert read-back: the row was JUST inserted with the correct tenantId
  // so cross-tenant is structurally impossible — no external id is accepted.
  ["server/services/inspection/inspection-core.service.ts:517",
    "post-insert read-back after createInspection — row was just inserted with tenantId"],

  // UPDATE-by-known-id patterns: the id was obtained from a prior tenant-scoped
  // fetch (e.g. sdb.getById, or a .where(tenantId) earlier in the same method).
  // Updating by an already-validated pk is safe because the pk could not have
  // been injected from user input without passing a prior tenant-scope check.

  // inspectionResults rows fetched by inspectionId (scoped to tenant via the
  // parent inspection guard) then updated/upserted by their own pk.
  ["server/services/inspection/inspection-annotations.service.ts:142",
    "update inspectionResults by pk — row fetched in same block with tenantId scope"],
  ["server/services/inspection/inspection-annotations.service.ts:226",
    "update inspectionResults by pk — row fetched in same block with tenantId scope"],
  ["server/services/inspection/inspection-photo.service.ts:75",
    "update inspectionResults by pk — row fetched earlier in same method with tenantId"],
  ["server/services/inspection/inspection-publish.service.ts:420",
    "update inspectionResults by pk — row fetched in same method with tenantId scope"],
  ["server/services/inspection/inspection-results.service.ts:110",
    "update inspectionResults by pk — existing row fetched with tenantId scope above"],
  ["server/services/inspection/inspection-results.service.ts:292",
    "update inspectionResults by pk — existing row fetched with tenantId scope above"],

  // inspectionConflicts: row was fetched via a prior scoped query; pk update is safe.
  ["server/services/conflicts.service.ts:113",
    "update inspectionConflicts by pk — row fetched in same loop with tenantId scope"],

  // contacts: update by pk of an `existing` row previously fetched with tenantId filter.
  ["server/services/contact.service.ts:225",
    "update contacts by pk — existing row fetched with eq(contacts.tenantId) above"],

  // agreementRequests / agreementSigners: update-by-pk of rows already validated
  // in the same request flow; conditional updates using non-terminal status guard.
  ["server/services/agreement/signer-state.ts:53",
    "select agreementRequests by pk — signer row was resolved via tokenHash scope above"],
  ["server/services/agreement/signer-state.ts:68",
    "update agreementRequests by pk — row already fetched with tenantId scope above"],
  ["server/services/agreement/signer-state.ts:108",
    "select agreementSigners by synthId — synthId is constructed (not external) in same fn"],
  ["server/services/agreement/signer-state.ts:139",
    "update agreementSigners by pk — row fetched with tenantId scope in same request"],
  ["server/services/agreement/signer-state.ts:242",
    "update agreementSigners by pk — row obtained from a tenant-scoped query chain"],
  ["server/services/agreement/signer-state.ts:281",
    "update agreementSigners by pk — conditional 'status NOT IN terminal' guard; signer pre-fetched"],
  ["server/services/agreement/signer-state.ts:307",
    "update agreementRequests by pk — conditional status guard; envelope pre-fetched with tenantId"],
  ["server/services/agreement/signer-state.ts:323",
    "update agreementRequests by pk — conditional status guard; envelope pre-fetched with tenantId"],
  ["server/services/agreement/signer-state.ts:353",
    "update agreementSigners by pk — conditional status guard; signer pre-fetched with tenantId"],
  ["server/services/agreement/signer-state.ts:367",
    "update agreementRequests by pk — conditional status guard; envelope pre-fetched with tenantId"],
  ["server/services/agreement/signer-state.ts:386",
    "update agreementRequests by pk — conditional status guard; envelope pre-fetched with tenantId"],
  ["server/services/agreement/envelope-legacy.ts:252",
    "select agreements by pk — only reachable after agreementRequests tenantId check"],
  ["server/services/agreement/envelope-legacy.ts:259",
    "update agreementRequests by pk — row already retrieved from tenant-scoped context"],
  ["server/services/agreement.service.ts:56",
    "select agreementRequests by pk — caller already validated tenantId at route layer"],

  // automations / automationLogs: all pk-only updates are on rows that were just
  // fetched/created within a per-tenant cron/trigger context.
  ["server/services/automation/core.ts:117",
    "select automations by pk — inside tenantId-bound trigger context"],
  ["server/services/automation/core.ts:144",
    "select automations by pk — inside tenantId-bound trigger context"],
  ["server/services/automation/delivery.ts:92",
    "update automationLogs by pk — log row originates from tenant-scoped fetch above"],
  ["server/services/automation/delivery.ts:122",
    "select inspectionEvents by pk — ev.id from a tenantId-scoped automationLogs row"],
  ["server/services/automation/delivery.ts:139",
    "update automationLogs by pk — log row originates from tenant-scoped fetch above"],
  ["server/services/automation/delivery.ts:148",
    "update automationLogs by pk — log row originates from tenant-scoped fetch above"],
  ["server/services/automation/delivery.ts:160",
    "update automationLogs by pk — log row originates from tenant-scoped fetch above"],
  ["server/services/automation/delivery.ts:175",
    "update automationLogs by pk — log row originates from tenant-scoped fetch above"],
  ["server/services/automation/delivery.ts:178",
    "update automationLogs by pk — log row originates from tenant-scoped fetch above"],
  ["server/services/automation/delivery.ts:184",
    "update automationLogs by pk — log row originates from tenant-scoped fetch above"],
  ["server/services/automation/sms.ts:40",
    "update automationLogs by pk — log row from tenant-scoped delivery context"],
  ["server/services/automation/sms.ts:78",
    "update automationLogs by pk — log row from tenant-scoped delivery context"],
  ["server/services/automation/sms.ts:84",
    "update automationLogs by pk — log row from tenant-scoped delivery context"],

  // eventTypes: read-back after a tenantId-scoped event fetch in same delivery loop.
  ["server/services/automation/delivery.ts:124",
    "select eventTypes by pk — ev row fetched in same loop with tenantId eq on inspectionEvents"],

  // automation/trigger: contact lookup by id within a per-tenant trigger context.
  ["server/services/automation/trigger.ts:132",
    "select contacts by pk — contactId from a tenant-scoped inspectionEvents row"],

  // qbo: upsert/update patterns — existing row fetched with tenantId scope above.
  ["server/services/qbo/api-base.ts:166",
    "update qboSyncErrors by pk — existing row fetched with tenantId scope above"],
  ["server/services/qbo/customer-sync.ts:63",
    "update qboEntityMap by pk — existing row fetched with tenantId scope above"],
  ["server/services/qbo/invoice-sync.ts:53",
    "update qboEntityMap by pk — mapped row fetched with tenantId scope above"],
  ["server/services/qbo/invoice-sync.ts:127",
    "update qboEntityMap by pk — existing row fetched with tenantId scope above"],
  ["server/services/qbo/invoice-sync.ts:182",
    "update qboEntityMap by pk — mapped row fetched with tenantId scope above"],

  // observerLinks: upsert/update by pk of a row fetched with tenantId scope.
  ["server/services/observer-link.service.ts:129",
    "update observerLinks by pk — legacy row fetched with tenantId scope above"],
  ["server/services/observer-link.service.ts:141",
    "update observerLinks by pk — link row obtained from tenant-scoped query"],

  // inspectionAccessTokens: upsert by pk of existing row fetched with tenantId scope.
  ["server/services/portal-access.service.ts:84",
    "update inspectionAccessTokens by pk — existing row fetched with tenantId scope above"],
  ["server/services/portal-access.service.ts:128",
    "update inspectionAccessTokens by pk — legacy row fetched with tenantId scope above"],

  // report-pdf: upsert by pk of existing row found in tenantId-scoped select.
  ["server/services/report-pdf.service.ts:300",
    "update reportPdfs by pk — existing row fetched with tenantId scope above"],

  // marketplace: marketplace_templates and marketplace_libraries are GLOBAL tables
  // (no per-tenant rows; any tenant can read/import from them). The tenantMarket*
  // import-tracking tables use upsert-by-pk on rows fetched with tenantId scope.
  ["server/services/marketplace.service.ts:189",
    "select marketplaceTemplates by pk — global table, no per-tenant isolation needed"],
  ["server/services/marketplace.service.ts:239",
    "update marketplaceTemplates by pk — global table, no per-tenant isolation needed"],
  ["server/services/marketplace.service.ts:276",
    "select marketplaceTemplates by pk — global table, no per-tenant isolation needed"],
  ["server/services/marketplace.service.ts:326",
    "update tenantMarketplaceImports by pk — existing row fetched with tenantId scope above"],
  ["server/services/marketplace.service.ts:331",
    "update marketplaceTemplates by pk — global table, no per-tenant isolation needed"],
  ["server/services/marketplace.service.ts:387",
    "select marketplaceLibraries by pk — global table, no per-tenant isolation needed"],
  ["server/services/marketplace.service.ts:429",
    "update marketplaceLibraries by pk — global table, no per-tenant isolation needed"],
  ["server/services/marketplace.service.ts:468",
    "select marketplaceLibraries by pk — global table, no per-tenant isolation needed"],
  ["server/services/marketplace.service.ts:527",
    "update tenantLibraryImports by pk — existing row fetched with tenantId scope above"],
  ["server/services/marketplace.service.ts:532",
    "update marketplaceLibraries by pk — global table, no per-tenant isolation needed"],

  // inspectionMessages: select by pk — message id comes from a tenantId-scoped list.
  ["server/services/message.service.ts:36",
    "select inspectionMessages by pk — id sourced from caller's tenant-scoped context"],

  // ai.service: select inspections by id — inside an already-authorized handler
  // where tenantId was validated at the Hono middleware layer.
  ["server/services/ai.service.ts:91",
    "select inspections by pk — called from route that validated tenantId in middleware"],

  // services.service: select services by id — called from tenant-bound context.
  ["server/services/service.service.ts:42",
    "select services by pk — caller validates tenantId before invoking"],

  // recommendation.service: select comments by pk within a tenantId-scoped list.
  ["server/services/recommendation.service.ts:70",
    "select comments by pk — row originates from tenant-scoped comment list"],

  // agent/referral: inspection lookup by id with JOIN-implicit tenant scope (the
  // agentTenantLinks JOIN enforces agentTenantLinks.tenantId = inspections.tenantId).
  ["server/services/agent/referral.ts:194",
    "select inspections by pk — agentTenantLinks JOIN provides implicit tenant scope"],

  // auth: tenantInvites keyed by token (which IS the pk); not a cross-tenant guess
  // because the token is a cryptographic secret, not an enumerable UUID.
  ["server/services/auth.service.ts:116",
    "select tenantInvites by token — token is a cryptographic pk, not an enumerable id"],
  ["server/services/auth.service.ts:144",
    "update tenantInvites by token — token is a cryptographic pk, not an enumerable id"],

  // concierge: inspection lookups from a tenantId-scoped concierge confirm token context.
  ["server/services/concierge.service.ts:322",
    "select inspections by pk — row.inspectionId from tenant-scoped conciergeConfirmTokens"],
  ["server/services/concierge.service.ts:395",
    "select inspections by pk — row.inspectionId from tenant-scoped conciergeConfirmTokens"],

  // email/transactional: inspection lookup from a trusted automation/cron context
  // where the inspectionId was validated by a prior tenant-scoped call.
  ["server/services/email/transactional.ts:103",
    "select inspections by pk — inspectionId from caller's tenant-scoped automation context"],

  // inspection-cascade: delete-by-id is the final step of a complete cascade that
  // already deleted all child rows via tenantId-scoped queries.
  ["server/services/inspection/inspection-cascade.ts:41",
    "delete inspections by pk — entire cascade is tenantId-scoped; delete is the last step"],

  // service.service: discount codes lookup by id from a caller-owned context.
  ["server/services/service.service.ts:117",
    "select discountCodes by pk — called from tenant-bound route context"],

  // template-migration: update inspectionResults by pk fetched in the same tenant loop.
  ["server/services/template-migration.service.ts:245",
    "update inspectionResults by pk — row fetched in same tenant-scoped migration loop"],

  // template.service: update/delete by pk — called from routes that validate tenantId.
  ["server/services/template.service.ts:215",
    "update templates by pk — caller validates tenantId ownership before invoking"],
  ["server/services/template.service.ts:237",
    "delete templates by pk — caller validates tenantId ownership before invoking"],

  // admin data-import: inspection/results update in admin-only batch path (sysadmin).
  ["server/api/admin/admin-data-import.ts:172",
    "select inspections by pk — admin-only import batch; sysadmin role required at route"],
  ["server/api/admin/admin-data-import.ts:288",
    "update inspectionResults by pk — admin-only; resultsRow fetched in same batch loop"],

  // agreements-render: public/client-facing rendering path; requestId comes from a
  // signed token that was already validated for this tenant's envelope.
  ["server/api/agreements-render.ts:136",
    "select agreementRequests by pk — requestId from a validated signed render token"],
  ["server/api/agreements-render.ts:152",
    "select agreements by pk — reqRow already fetched by tenantId-validated requestId"],
  ["server/api/agreements-render.ts:245",
    "select agreementRequests by pk — requestId from a validated signed render token"],

  // inspection-sync: upsert inspectionResults by pk (same tenant-scoped insert/update
  // loop); select inspections by pk (sync path, caller already validated tenantId).
  ["server/api/inspection-sync.ts:199",
    "update inspectionResults by pk — row from same tenant-scoped sync upsert loop"],
  ["server/api/inspection-sync.ts:296",
    "select inspections by pk — sync path, tenantId validated at route middleware"],

  // inspections/agreements: agreementRequests by pk — env.requestId from a
  // pre-validated inspection-scoped envelope context.
  ["server/api/inspections/agreements.ts:178",
    "select agreementRequests by pk — env.requestId from inspection-scoped envelope"],
  ["server/api/inspections/agreements.ts:246",
    "select agreementRequests by pk — env.requestId from inspection-scoped envelope"],

  // auth: third tenantInvites lookup by token (same cryptographic pk pattern as 116/144).
  ["server/services/auth.service.ts:171",
    "select tenantInvites by token — token is a cryptographic pk, not an enumerable id"],

  // event.service: post-update read-back (id just used in an AND-tenantId UPDATE above);
  // and inspections fetched by id where inspectionId came from an already-scoped event row.
  ["server/services/event.service.ts:127",
    "select inspectionEvents by pk — post-update read-back; UPDATE at line 124 had tenantId"],
  ["server/services/event.service.ts:142",
    "select inspections by pk — inspectionId from a tenant-scoped inspectionEvents row above"],
  ["server/services/event.service.ts:163",
    "select inspections by pk — inspectionId from a tenant-scoped inspectionEvents row above"],

  // service.service: post-update read-back (UPDATE at line 56 had AND tenantId).
  ["server/services/service.service.ts:57",
    "select services by pk — post-update read-back; UPDATE above included eq(services.tenantId)"],

  // bookings/agreement: agreements fetched by pk to read display name only;
  // envelope.agreementId came from a tenant-scoped envelope.
  ["server/api/bookings/agreement.ts:214",
    "select agreements by pk — envelope.agreementId from tenant-scoped envelope context"],
  ["server/api/bookings/agreement.ts:265",
    "select agreements by pk — envelope.agreementId from tenant-scoped envelope context"],

  // evidence.ts: agreementRequests fetched by envelopeId then post-fetch tenant-checked
  // (row.tenantId !== tenantId check immediately follows; safe fail-closed pattern).
  ["server/api/evidence.ts:24",
    "select agreementRequests by pk — post-fetch row.tenantId check at line 25"],
  ["server/api/evidence.ts:50",
    "select agreementRequests by pk — post-fetch row.tenantId check at line 51"],
  ["server/api/evidence.ts:76",
    "select agreementRequests by pk — post-fetch row.tenantId check at line 77"],

  // inspection-sync: update inspectionResults by pk — row.id from the same tenantId-scoped
  // SELECT earlier in the same function; pk could not have been externally injected.
  ["server/api/inspection-sync.ts:123",
    "update inspectionResults by pk — row.id from tenant-scoped select above in same fn"],
  ["server/api/inspection-sync.ts:251",
    "update inspectionResults by pk — row.id from tenant-scoped select above in same fn"],

  // inspections/agreements: agreements fetched by agreementId from a tenant-scoped envelope.
  ["server/api/inspections/agreements.ts:183",
    "select agreements by pk — envelope.agreementId from tenant-scoped envelope above"],

  // public-report: inspections fetched by id to RESOLVE the tenant (render-token path).
  // The id comes from a cryptographically signed render token, not raw user input.
  ["server/api/public-report.ts:291",
    "select inspections by pk — id from signed render token; fetching tenantId from inspection"],
  ["server/api/public-report.ts:352",
    "select inspections by pk — id from signed render token; fetching tenantId from inspection"],
]);

// ---------------------------------------------------------------------------
// Schema walk: extract camelCase identifiers for tenant-scoped tables
// ---------------------------------------------------------------------------
function walkFiles(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".mjs")) out.push(p);
  }
  return out;
}

function buildTenantTableIdents(schemaDir) {
  const idents = new Set();
  for (const file of walkFiles(schemaDir)) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/const\s+(\w+)\s*=\s*sqliteTable/);
      if (!m) continue;
      // Scan forward up to 80 lines for a `tenant_id` column declaration.
      const block = lines.slice(i, i + 80).join("\n");
      if (/['"]tenant_id['"]/.test(block)) idents.add(m[1]);
    }
  }
  // tenant_destruction_records carries a tenant_id snapshot but is the durable
  // non-personal compliance proof — it MUST survive a tenant purge. Mirror the
  // same exclusion used in scoped-tables.ts.
  idents.delete("tenantDestructionRecords");
  // users: every user-row lookup is self-referential (authenticated JWT `sub`).
  // The authenticated user can only ever see their own row, so there is no
  // cross-tenant id-guess risk. Excluding avoids false-positives on the many
  // auth-layer `eq(users.id, user.sub)` / `eq(users.id, userId)` queries.
  idents.delete("users");
  return idents;
}

// ---------------------------------------------------------------------------
// Core heuristic (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Extracts the balanced content of the first `.where(` expression starting at
 * or after position `pos` in `source`.  Returns `{ start, content }` where
 * `start` is the index of `.where(` and `content` is everything from the
 * opening `(` to its matching `)` (inclusive).  Returns null if no `.where(`
 * is found at or after `pos`.
 */
function extractWhereExpr(source, pos) {
  const idx = source.indexOf(".where(", pos);
  if (idx === -1) return null;
  const openParen = idx + ".where".length; // points at '('
  let depth = 0;
  let i = openParen;
  while (i < source.length) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return { start: idx, content: source.slice(openParen, i + 1) };
    }
    i++;
  }
  return null; // unmatched — shouldn't happen in valid TS
}

/**
 * Scans `source` for `.where(...)` expressions that contain `eq(TABLE.id,`
 * for any table in `tenantTables` but do NOT also contain a `tenantId` /
 * `tenant_id` token in the same balanced expression.
 *
 * @param {string} source - TypeScript source code to scan.
 * @param {Set<string>} tenantTables - Set of camelCase table identifier names.
 * @returns {{ line: number, context: string }[]} Array of hit objects.
 */
function findUnscopedByIdQueries(source, tenantTables) {
  if (tenantTables.size === 0) return [];
  const tableAlt = [...tenantTables].join("|");
  // Matches eq(TABLE.id, or eq(schema.TABLE.id,
  const byIdRe = new RegExp(`eq\\((?:\\w+\\.)?(?:${tableAlt})\\.id[,\\s]`);
  const hits = [];
  let pos = 0;
  while (pos < source.length) {
    const result = extractWhereExpr(source, pos);
    if (!result) break;
    const { start, content } = result;
    if (byIdRe.test(content) && !/tenantId|tenant_id/.test(content)) {
      // Compute 1-based line number of the `.where(` token
      const line = source.slice(0, start).split("\n").length;
      // Context: the line containing `.where(`
      const lineStart = source.lastIndexOf("\n", start) + 1;
      const lineEnd = source.indexOf("\n", start);
      const context = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim();
      hits.push({ line, context });
    }
    pos = start + 1; // advance past this `.where(` to find next
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Main scan (only runs when executed directly, not when imported)
// ---------------------------------------------------------------------------
// Normalize both sides to forward-slash lowercase so Windows drive letters
// don't break the comparison.
const _scriptPath = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1").toLowerCase();
const _argv1 = (process.argv[1] ?? "").replace(/\\/g, "/").toLowerCase();
if (_scriptPath === _argv1 || _argv1.endsWith("/check-tenant-scoping.mjs")) {
  const tenantTables = buildTenantTableIdents(SCHEMA_DIR);

  const violations = [];
  const warned = [];

  for (const scanDir of SCAN_DIRS) {
    for (const file of walkFiles(scanDir)) {
      if (!file.endsWith(".ts")) continue;
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const source = readFileSync(file, "utf8");
      const hits = findUnscopedByIdQueries(source, tenantTables);
      for (const hit of hits) {
        const key = `${rel}:${hit.line}`;
        if (ALLOW.has(key)) {
          warned.push({ key, reason: ALLOW.get(key), context: hit.context });
        } else {
          violations.push({ key, context: hit.context });
        }
      }
    }
  }

  if (warned.length > 0) {
    console.warn(`Tenant-scoping gate: ${warned.length} ALLOW-listed (audited safe) entries:`);
    for (const w of warned) {
      console.warn(`  [ALLOW] ${w.key}  — ${w.reason}`);
    }
  }

  if (violations.length > 0) {
    console.error("\nTenant-scoping gate FAILED — new unscoped by-id queries detected:\n");
    console.error(
      "  These queries fetch/update a tenant-scoped table row by `id` alone, without\n" +
        "  a `tenantId` filter in the same .where() expression. This is a cross-tenant\n" +
        "  data-leak vector.\n\n" +
        "  Fix options:\n" +
        "    (a) Add `eq(table.tenantId, tenantId)` to the .where() clause.\n" +
        "    (b) Use `this.sdb.getById(table, id)` (auto-scopes by tenantId).\n" +
        "    (c) If provably safe (pk from prior scoped fetch, post-insert read-back,\n" +
        "        or truly global table), add to ALLOW in scripts/check-tenant-scoping.mjs\n" +
        "        with a one-line justification.\n",
    );
    for (const v of violations) {
      console.error(`  ${v.key}  →  ${v.context.substring(0, 120)}`);
    }
    console.error(`\n${violations.length} violation(s).`);
    process.exit(1);
  }

  console.log(`Tenant-scoping gate: OK (${warned.length} ALLOW-listed entries, 0 violations)`);
}
