#!/usr/bin/env node
/**
 * Entry-dispatch parity gate.
 *
 * `workers/app.ts` is the worker entry. It forwards an ALLOW-LIST of prefixes to
 * the Hono API app and sends everything else to React Router. A Hono route whose
 * prefix is missing from that list does not 500 and does not warn: it reaches
 * React Router, which has no such route, and the caller gets a 404 page. Unit
 * tests never see it, because they call the Hono handler directly and never go
 * through the entry at all.
 *
 * The list rots in the other direction too. A forwarded prefix with nothing
 * behind it is a line that describes a route that no longer exists, and once
 * there are a few of them nobody trusts the list enough to prune it.
 *
 * So this compares the two sets in BOTH directions:
 *   - mounted but not forwarded  → the silent 404 above
 *   - forwarded but not mounted  → a dead allow-list entry
 *
 * THREE THINGS IT HAS TO GET RIGHT
 * --------------------------------
 * 1. Effective addresses, not written literals. Comparing first path segments
 *    would fold `/api/platform` into `/api` and `/agent/magic-login` into
 *    `/agent`, and a prefix pair that differs after the first segment would
 *    compare equal. Every comparison below is against the full address.
 *
 * 2. Root mounts. `.route('/', someRouter)` puts the sub-router's own paths at
 *    the top level, so the literal `'/'` says nothing about what is served.
 *    Guessing is not an option (the modules holding those routers also hold
 *    dozens of routes mounted elsewhere), so each root mount must be DECLARED
 *    below — and the declaration is then checked against the sub-router's own
 *    source, so it is a claim about the code and not about itself. An
 *    undeclared root mount is a failure: that is the one shape that could
 *    otherwise add a top-level address with nothing noticing.
 *
 * 3. `/mcp` is owned by neither side. The OAuthProvider wraps the whole app in
 *    `workers/app.ts`'s default export and matches `/mcp` as a literal prefix
 *    before this router ever runs. It is therefore correct that the entry does
 *    NOT forward it, and forwarding it would be a behaviour change (with the
 *    MCP flag off, the path must fall through to the SSR 404). Recorded as
 *    provider-owned and asserted — against the deployment profile's own value,
 *    not against a literal typed here.
 *
 * Both set sizes print on every run, and an empty set on either side is a
 * failure: a gate comparing nothing to nothing is green for the wrong reason.
 *
 * Usage: node scripts/check-route-dispatch-parity.mjs
 */
import { collectMounts, readSource, repoRoot, stripComments } from "./lib/route-source.mjs";
import { join } from "node:path";

const ROOT = repoRoot(import.meta.url, "..");
const ENTRY = join(ROOT, "workers", "app.ts");
const HONO_SOURCES = [
  { path: join(ROOT, "server", "index.ts"), label: "server/index.ts" },
  { path: join(ROOT, "server", "portal", "integration.module.ts"), label: "server/portal/integration.module.ts" },
];

/**
 * Sub-routers mounted at `'/'`, with the top-level addresses they serve and the
 * module that defines them. `verify` is the literal this gate greps for in that
 * module: the declaration has to be answerable by the sub-router's own source,
 * otherwise it is just a second place to be wrong.
 */
const ROOT_MOUNTS = new Map([
  ["ssoRootRoutes", {
    module: join(ROOT, "server", "api", "auth.ts"),
    paths: ["/sso"],
    verify: "path: '/sso'",
    why: "portal mints an ABSOLUTE /sso URL and the browser follows it, so this one auth route answers at the root as well as under /api/auth",
  }],
  ["agentMagicLoginRedeemRoutes", {
    module: join(ROOT, "server", "api", "agent", "magic-login.ts"),
    paths: ["/agent/magic-login"],
    verify: "path: '/agent/magic-login'",
    why: "the agent unified link is redeemed by following an emailed absolute URL — same reason as /sso, mounted at the root rather than under /api",
  }],
]);

/**
 * Addresses the Hono app registers that the entry deliberately does not forward,
 * because something else answers them first. Each prints its suppression count:
 * an entry suppressing nothing is describing a route that is gone.
 */
const NOT_FORWARDED_ON_PURPOSE = [
  { path: "/", why: "React Router owns the index route; this Hono redirect is unreachable through the entry and the RR index is what a visitor gets" },
  { path: "/favicon.svg", why: "served by the Cloudflare assets layer from build/client before the worker runs" },
  { path: "/logo.svg", why: "served by the Cloudflare assets layer from build/client before the worker runs" },
  { path: "/vendor/*", why: "served by the Cloudflare assets layer from build/client before the worker runs" },
  { path: "/fonts.css", why: "served by the Cloudflare assets layer from build/client before the worker runs" },
  { path: "/fonts/*", why: "served by the Cloudflare assets layer from build/client before the worker runs" },
  { path: "/setup", why: "React Router serves the setup page (app/routes.ts route(\"setup\")); the Hono mount is a profile gate the entry never reaches" },
  { path: "/agreement-sign", why: "React Router owns /agreements/*; this Hono handler only redirects to a not-found page, which is what React Router renders anyway" },
  { path: "/agreements/sign", why: "React Router owns /agreements/sign/:tenant/:token; this Hono handler only redirects to a not-found page" },
];

/** Prefixes owned by the OAuthProvider wrapper, which runs before this router. */
const PROVIDER_OWNED = [
  {
    prefix: "/mcp",
    authority: { file: join(ROOT, "server", "lib", "deployment-profile.ts"), key: "mcpApiRoute" },
    why: "buildOAuthHandler wraps the whole app and matches the profile's mcpApiRoute as a literal path prefix, so /mcp never reaches this router; forwarding it would be a lie about ownership AND a behaviour change with the flag off",
  },
];

const failures = [];
const fail = (msg) => failures.push(msg);

// ---------------------------------------------------------------- entry side
const entrySource = readSource(ENTRY);
if (entrySource === null) {
  console.error("route-dispatch: FAIL — workers/app.ts does not exist. The gate cannot read the entry.");
  process.exit(1);
}
const entry = collectMounts(ENTRY, entrySource, "workers/app.ts");
/** `*` is the React Router catch-all, not a forwarded prefix. */
const forwarded = entry.mounts.filter((m) => m.path.startsWith("/"));

// ----------------------------------------------------------------- hono side
const mounted = [];
let honoRaw = 0;
const dropped = [...entry.dropped];
for (const src of HONO_SOURCES) {
  const text = readSource(src.path);
  if (text === null) {
    fail(`${src.label} does not exist — the gate cannot read the mounted set.`);
    continue;
  }
  const run = collectMounts(src.path, text, src.label);
  honoRaw += run.raw.length;
  dropped.push(...run.dropped);
  for (const u of run.unresolved) fail(`${u.file}:${u.line} mounts at the unresolvable identifier ${u.identifier} (${u.why})`);
  for (const m of run.mounts) {
    // Only `.route('/', X)` is a root MOUNT, where the literal says nothing
    // about what is served and the sub-router's own paths land at the top
    // level. `app.get('/', …)` is an ordinary address that happens to be `/`.
    mounted.push(m.path === "/" && m.kind === "prefix" ? { ...m, root: true } : m);
  }
}

/**
 * Resolve `.route('/', X)` to the addresses X serves, from ROOT_MOUNTS, and
 * check each declaration against the sub-router's own module.
 */
const rootMountUses = [];
for (const src of HONO_SOURCES) {
  const text = readSource(src.path);
  if (text === null) continue;
  for (const m of stripComments(text).matchAll(/\.route\(\s*['"]\/['"]\s*,\s*([A-Za-z_$][\w$]*)/g)) {
    const identifier = m[1];
    const decl = ROOT_MOUNTS.get(identifier);
    if (!decl) {
      fail(
        `${src.label} mounts ${identifier} at '/', which puts its paths at the TOP LEVEL, and this gate has no declaration for it. ` +
        `Add one to ROOT_MOUNTS with the addresses it serves — an undeclared root mount is the one shape that can add a top-level address unnoticed.`,
      );
      continue;
    }
    const moduleSource = readSource(decl.module);
    if (moduleSource === null) {
      fail(`the declaration for ${identifier} names a module that does not exist: ${decl.module}`);
      continue;
    }
    if (!moduleSource.includes(decl.verify)) {
      fail(
        `the declaration for ${identifier} says it serves ${decl.paths.join(", ")}, but its module does not contain ${JSON.stringify(decl.verify)}. ` +
        `The declaration has drifted from the router it describes.`,
      );
      continue;
    }
    rootMountUses.push({ identifier, ...decl, file: src.label });
  }
}

/** Effective addresses the Hono app answers: literal mounts + resolved root mounts. */
const effective = [
  ...mounted.filter((m) => !m.root).map((m) => ({ address: m.path, kind: m.kind, from: `${m.file}:${m.line}` })),
  ...rootMountUses.flatMap((r) => r.paths.map((p) => ({ address: p, kind: "exact", from: `${r.file} via ${r.identifier}` }))),
];

// -------------------------------------------------------------- the two sets
/** Does a forwarded pattern route every request under a mounted address? */
function covers(pattern, address) {
  if (pattern.endsWith("/*")) {
    const base = pattern.slice(0, -2);
    return address === base || address.startsWith(`${base}/`);
  }
  return pattern === address;
}

const skipped = NOT_FORWARDED_ON_PURPOSE.map(() => []);
const unforwarded = [];
for (const e of effective) {
  const skipIndex = NOT_FORWARDED_ON_PURPOSE.findIndex((s) => s.path === e.address);
  if (skipIndex !== -1) { skipped[skipIndex].push(e.from); continue; }
  if (!forwarded.some((f) => covers(f.path, e.address))) {
    unforwarded.push(e);
  }
}

const dead = forwarded.filter((f) => !effective.some((e) => covers(f.path, e.address)));

console.log(
  `route-dispatch: ${effective.length} effective Hono addresses vs ${forwarded.length} forwarded prefixes ` +
  `(${honoRaw + entry.raw.length} registrations before comment-stripping, ${dropped.length} dropped as comment text); ` +
  `${unforwarded.length} unforwarded, ${dead.length} dead entries, ` +
  `${NOT_FORWARDED_ON_PURPOSE.length} deliberate skips suppressing ${skipped.reduce((n, s) => n + s.length, 0)}, ` +
  `${rootMountUses.length} root mounts resolved, ${PROVIDER_OWNED.length} provider-owned prefixes`,
);
for (const d of dropped) console.log(`  stripped as comment: ${d}`);
for (const r of rootMountUses) console.log(`  root mount: ${r.identifier} -> ${r.paths.join(", ")} — ${r.why}`);
for (const [i, s] of NOT_FORWARDED_ON_PURPOSE.entries()) {
  console.log(`  skipped: ${s.path} — suppressed ${skipped[i].length} — ${s.why}`);
}
for (const p of PROVIDER_OWNED) console.log(`  provider-owned: ${p.prefix} — ${p.why}`);

// ------------------------------------------------------------- the judgements
if (effective.length === 0 || forwarded.length === 0) {
  fail("one of the two sets is empty — the gate is comparing nothing to nothing, which is not a pass.");
}
for (const e of unforwarded) {
  fail(`mounted but not forwarded: ${e.address} (${e.from}) — it would reach React Router and 404.`);
}
for (const d of dead) {
  fail(`forwarded but never mounted: ${d.path} (${d.file}:${d.line}) — a dead allow-list entry.`);
}
for (const [i, s] of NOT_FORWARDED_ON_PURPOSE.entries()) {
  if (skipped[i].length === 0) {
    fail(`the deliberate skip ${s.path} suppressed nothing this run — the route it describes is gone, so delete the entry.`);
  }
}
for (const p of PROVIDER_OWNED) {
  const authority = readSource(p.authority.file);
  const declared = authority === null
    ? []
    : [...authority.matchAll(new RegExp(`${p.authority.key}\\s*:\\s*'([^']+)'`, "g"))].map((m) => m[1]);
  if (declared.length === 0) {
    fail(`could not read ${p.authority.key} out of ${p.authority.file} — the provider-owned prefix ${p.prefix} is unverified.`);
  } else if (declared.some((v) => v !== p.prefix)) {
    fail(`${p.authority.key} declares ${[...new Set(declared)].join(", ")}, but this gate records ${p.prefix} as provider-owned. One of the two moved.`);
  }
  const forwardedProviderPath = forwarded.find((f) => f.path === p.prefix || f.path.startsWith(`${p.prefix}/`));
  if (forwardedProviderPath) {
    fail(
      `the entry forwards ${forwardedProviderPath.path} (workers/app.ts:${forwardedProviderPath.line}), but ${p.prefix} is owned by the OAuthProvider wrapper. ` +
      `Forwarding it changes behaviour with the MCP flag off, where the path must fall through to the SSR 404.`,
    );
  }
}

for (const f of failures) console.error(`  FAIL ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
