#!/usr/bin/env node
/**
 * URL taxonomy gate.
 *
 * Three rules about where things are allowed to mount:
 *
 *   1. Every inbound provider webhook mounts at the TOP LEVEL, under
 *      `/webhooks/`, never under `/api/`. The producer owns the request shape,
 *      the headers and the signature, and none of the `/api/*` middleware
 *      applies to any of it — least of all the subscription gate, since a
 *      lapsed tenant is exactly when a provider most needs delivery to work.
 *
 *   2. The portal->engine M2M seam is `/api/platform/`. Anything under
 *      `/api/integration...` is a violation unless it is the plural family
 *      below: the retired singular sat one letter from `/api/integrations/*`,
 *      a different caller with a different auth mechanism, and the two were
 *      told apart by nothing but that letter.
 *
 *   3. `/company/` is the portal's container-word prefix. This app must not
 *      mount it, in any form.
 *
 * WHAT IT READS, AND WHAT IT DELIBERATELY DOES NOT
 * ------------------------------------------------
 * Only route registration points, in the three files that define this worker's
 * URL surface. Not comments, not migrations, not docs. This is a construction,
 * not an allow-list: a path in prose simply is not a mount. Widening it into a
 * full-text grep would be an active mistake — the repo deliberately keeps
 * historical names for endpoints that no longer exist (a name that once existed
 * should be spelled the way it was), and a full-text grep cannot tell those from
 * live paths. It would force people to rewrite history to get to green.
 *
 * HOW IT SAYS WHAT IT SAW
 * -----------------------
 * Every run prints what it CHECKED next to what it FOUND, per file. Zero mount
 * points is a failure, not a pass. So is a count that dropped below a file's
 * floor: "the gate went blind" and "the gate is clean" both print small numbers,
 * and only the floor tells them apart. Every exemption prints its reason AND how
 * many violations it suppressed this run — an exemption suppressing none no
 * longer covers anything and is a failure, because that is how an allow-list
 * quietly grows the authority to hide a real violation later.
 *
 * Usage: node scripts/check-url-taxonomy.mjs
 */
import { collectMounts, readSource, repoRoot } from "./lib/route-source.mjs";
import { join } from "node:path";

const ROOT = repoRoot(import.meta.url, "..");

/**
 * The files whose `.route(...)` / `app.<verb>(...)` calls define the URL
 * surface. `floor` is the smallest mount count each has legitimately had; it is
 * the guard against the gate silently seeing less than it used to. Lower one
 * only alongside the change that actually removed routes, and say so.
 */
const SOURCES = [
  { path: join(ROOT, "server", "index.ts"), label: "server/index.ts", floor: 100 },
  { path: join(ROOT, "server", "portal", "integration.module.ts"), label: "server/portal/integration.module.ts", floor: 2 },
  { path: join(ROOT, "workers", "app.ts"), label: "workers/app.ts", floor: 12 },
];

/**
 * Exempt mounts, each with the reason, each counted.
 *
 * Rule 2 is deliberately written to catch the whole `/api/integration...`
 * family and then let the plural back through here, rather than encoding the
 * exception in the rule itself. The difference matters: with the exception in
 * the rule, `/api/integration` and `/api/integrations` are two silently
 * different cases; here they are one case and a decision, and the decision
 * prints its suppression count every run. If that count ever reaches zero the
 * tenant-facing integrations API has gone, and this entry must go with it.
 *
 * ⚠️ `rules` is not optional and not decoration. An exemption written against
 * the PATH alone excuses that path from every rule, including ones nobody was
 * thinking about when they wrote it — a webhook mounted at
 * `/api/integrations/stripe/webhook` would land inside this exemption and rule
 * 1 would never be asked. Naming the rule keeps the exemption the size of the
 * decision that was actually made.
 */
const EXEMPT = [
  {
    match: (p) => p === "/api/integrations" || p.startsWith("/api/integrations/"),
    label: "/api/integrations[/*]",
    rules: ["m2m-seam-is-platform"],
    why: "the tenant's OWN QuickBooks/Stripe settings API — plural, human-facing, session-authenticated, and deliberately under /api/ because all of that middleware does apply to it",
  },
];

const RULES = [
  {
    id: "webhook-top-level",
    applies: (p) => /webhook/i.test(p),
    ok: (p) => p === "/webhooks" || p.startsWith("/webhooks/"),
    say: "inbound webhooks mount at top-level /webhooks/, never under /api/",
  },
  {
    id: "m2m-seam-is-platform",
    applies: (p) => p.startsWith("/api/integration"),
    ok: () => false,
    say: "the portal->engine M2M seam is /api/platform/, not /api/integration/",
  },
  {
    id: "no-company-prefix",
    applies: (p) => p === "/company" || p.startsWith("/company/"),
    ok: () => false,
    say: "/company/ belongs to portal; this engine must not mount it",
  },
];

let blind = false;
const violations = [];
const suppressed = EXEMPT.map(() => []);
const perFile = [];
let rawTotal = 0;
let checkedTotal = 0;
const droppedByStripping = [];
const unresolved = [];

for (const src of SOURCES) {
  const text = readSource(src.path);
  if (text === null) {
    console.error(`url-taxonomy: FAIL — ${src.label} does not exist. The gate cannot read its own subject.`);
    blind = true;
    continue;
  }
  const { mounts, raw, dropped, unresolved: bad } = collectMounts(src.path, text, src.label);
  perFile.push({ label: src.label, count: mounts.length, raw: raw.length, floor: src.floor });
  checkedTotal += mounts.length;
  rawTotal += raw.length;
  droppedByStripping.push(...dropped);
  unresolved.push(...bad);

  for (const mount of mounts) {
    for (const rule of RULES) {
      if (!rule.applies(mount.path) || rule.ok(mount.path)) continue;
      const exemptIndex = EXEMPT.findIndex((e) => e.rules.includes(rule.id) && e.match(mount.path));
      if (exemptIndex !== -1) { suppressed[exemptIndex].push(`${mount.path} (${rule.id})`); continue; }
      violations.push({ ...mount, rule: rule.say });
    }
  }
}

console.log(
  `url-taxonomy: checked ${checkedTotal} mount points across ${SOURCES.length} files ` +
  `(${rawTotal} before comment-stripping, ${droppedByStripping.length} dropped as comment text), ` +
  `found ${violations.length} violations, ${EXEMPT.length} exemptions suppressed ` +
  `${suppressed.reduce((n, s) => n + s.length, 0)}`,
);
for (const f of perFile) console.log(`  read: ${f.label} — ${f.count} mounts (raw ${f.raw}, floor ${f.floor})`);
for (const d of droppedByStripping) console.log(`  stripped as comment: ${d}`);
for (const [i, e] of EXEMPT.entries()) {
  console.log(`  exempt: ${e.label} — suppressed ${suppressed[i].length} — ${e.why}`);
  for (const s of suppressed[i]) console.log(`      ${s}`);
}

/**
 * A gate that matched nothing is not a clean repo, and neither is one that
 * matched fewer mounts than the file has ever had. Both print a small number;
 * only the floor tells them apart.
 */
if (checkedTotal === 0) {
  console.error("url-taxonomy: FAIL — matched ZERO mount points. The gate is blind, not clean.");
  blind = true;
}
for (const f of perFile) {
  if (f.count < f.floor) {
    console.error(
      `url-taxonomy: FAIL — ${f.label} yielded ${f.count} mounts, below its floor of ${f.floor}. ` +
      `Either routes were removed (lower the floor in the same change, with the reason) or the scanner stopped seeing them.`,
    );
    blind = true;
  }
}
for (const u of unresolved) {
  console.error(
    `url-taxonomy: FAIL — ${u.file}:${u.line} mounts at the identifier ${u.identifier}, which this gate could not resolve (${u.why}). ` +
    `An unreadable mount is the one case where the gate must say it went blind rather than skip.`,
  );
  blind = true;
}
for (const [i, e] of EXEMPT.entries()) {
  if (suppressed[i].length === 0) {
    console.error(
      `url-taxonomy: FAIL — the exemption ${e.label} suppressed nothing this run. ` +
      `It no longer covers anything and must be deleted, not inherited.`,
    );
    blind = true;
  }
}

for (const v of violations) {
  console.error(`  FAIL ${v.file}:${v.line} mounts ${v.path} — ${v.rule}`);
}

process.exit(blind || violations.length > 0 ? 1 : 0);
