#!/usr/bin/env node
/**
 * check-middleware-budget.mjs — a static ratchet over the three things that can
 * silently undo request-scoped middleware memoisation.
 *
 * WHY THIS GATE EXISTS
 *
 * One page render is not one trip through the middleware chain. The React
 * Router SSR handler fans a render out into many in-process API calls through
 * the `API_WORKER` self-binding in `workers/app.ts`, and Hono runs the whole
 * global `app.use('*')` chain on every one of them. Those inner calls share one
 * request scope, so per-request work (auth decisions, tenant resolution, DI
 * construction) is computed once and reused. Three drift vectors break that,
 * and all three are visible without running anything:
 *
 *   1. A NEW GLOBAL `app.use('*')` IN `server/index.ts`.
 *      Global middleware is charged once per in-process call, not once per
 *      render, so its true cost is the fan-out multiple of what it looks like
 *      when you read the diff. Path-scoped middleware (`app.use('/api/*', …)`)
 *      is not counted here — it is not on the blanket chain.
 *
 *   2. A NEW IN-PROCESS API CALL FROM A LOADER UNDER `app/`.
 *      Every added call multiplies vector 1 again. The fan-out is a budget:
 *      it may shrink freely, but it may not grow without someone deciding that
 *      it should and re-baselining deliberately.
 *
 *   3. THE REQUEST SCOPE LEAKING INTO `toApi` IN `workers/app.ts`.
 *      This is the SECURITY invariant of the whole design, not a performance
 *      one. `toApi` is the entry for real external HTTP traffic. The scope is
 *      installed in `ssr` only, so memoisation is unreachable from outside by
 *      construction rather than by a runtime flag. If `toApi` ever passes an
 *      env carrying the scope, unrelated external requests would begin sharing
 *      memoised authentication and tenant decisions with each other. There is
 *      no baseline number for this one — the only acceptable value is zero.
 *
 * WHAT THE FAN-OUT NUMBERS ARE, AND ARE NOT
 *
 * The `$`-method count is DELIBERATELY OVER-INCLUSIVE. It matches
 * `$get|$post|$put|$patch|$delete` with no requirement of a following `(`,
 * because the call sites in this codebase take at least three shapes:
 *
 *   A. inline invocation      — `await api.inspections[":id"].hub.$get({ … })`
 *   B. method extracted first — `const g = api.x?.[":id"]?.people?.$get as …`
 *      (here `$get` is a value, never followed by `(`)
 *   D. raw self-binding fetch — `(apiWorker?.fetch ?? fetch)(new Request(…))`
 *      (no `$`-method appears at all; this is why `API_WORKER` is counted
 *      separately and reported alongside)
 *
 * A pattern tight enough to exclude non-calls missed roughly 40% of the real
 * call sites. So these counts also pick up `$`-methods that appear inside type
 * annotations and, in at least one file, inside a comment. THE NUMBERS ARE NOT
 * A PRECISE CALL COUNT and must not be quoted as one. They are a drift signal:
 * a slightly over-inclusive count still moves when, and only when, someone adds
 * or removes a call site, which is exactly what a ratchet needs.
 *
 * USAGE
 *   node scripts/check-middleware-budget.mjs            # check against baseline
 *   node scripts/check-middleware-budget.mjs --update   # regenerate baseline
 *
 * Every check prints its measured value AND its baseline on every run, pass or
 * fail, because a gate that prints only a verdict cannot be audited. Scanning
 * zero files, or matching zero global `app.use('*')`, is treated as a BROKEN
 * MATCHER and fails — an empty result set otherwise reads as green, which is
 * how a dead instrument hides.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const BASELINE_PATH = join(HERE, "middleware-budget-baseline.json");
const BASELINE_REL = "scripts/middleware-budget-baseline.json";

const SERVER_INDEX = "server/index.ts";
const WORKER_ENTRY = "workers/app.ts";
const APP_DIR = "app";

const UPDATE = process.argv.includes("--update");

/** Repo-relative POSIX path, so baseline keys are identical on Windows and CI. */
const rel = (abs) => relative(ROOT, abs).split("\\").join("/");

const read = (relPath) => readFileSync(join(ROOT, relPath), "utf8");

const countMatches = (source, regex) => {
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  let n = 0;
  while (re.exec(source) !== null) n += 1;
  return n;
};

const failures = [];
const hints = [];
const fail = (msg) => failures.push(msg);

// ---------------------------------------------------------------------------
// Measure
// ---------------------------------------------------------------------------

/** Check 1 — global `app.use('*')` / `app.use("*")`. Path-scoped uses excluded. */
function measureGlobalUse() {
  if (!existsSync(join(ROOT, SERVER_INDEX))) {
    fail(`${SERVER_INDEX} does not exist — the gate cannot measure global middleware.`);
    return 0;
  }
  return countMatches(read(SERVER_INDEX), /app\.use\(\s*(['"])\*\1/g);
}

/** Check 2 — per-file in-process API call surface under `app/`. */
function measureFanOut() {
  const files = [];
  let skipped = 0;

  const walk = (absDir) => {
    for (const entry of readdirSync(absDir)) {
      const abs = join(absDir, entry);
      if (statSync(abs).isDirectory()) {
        if (entry === "node_modules") continue;
        walk(abs);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      if (/\.(test|spec)\./.test(entry)) {
        skipped += 1;
        continue;
      }
      files.push(abs);
    }
  };

  const appAbs = join(ROOT, APP_DIR);
  if (!existsSync(appAbs)) {
    fail(`${APP_DIR}/ does not exist — the fan-out matcher has nothing to scan.`);
    return { map: {}, scanned: 0, skipped: 0, totals: { files: 0, dollarMethods: 0, apiWorker: 0 } };
  }
  walk(appAbs);

  const map = {};
  const totals = { files: 0, dollarMethods: 0, apiWorker: 0 };
  for (const abs of files) {
    const src = readFileSync(abs, "utf8");
    const dollarMethods = countMatches(src, /\$(get|post|put|patch|delete)\b/g);
    const apiWorker = countMatches(src, /API_WORKER/g);
    if (dollarMethods === 0 && apiWorker === 0) continue;
    map[rel(abs)] = { dollarMethods, apiWorker };
    totals.files += 1;
    totals.dollarMethods += dollarMethods;
    totals.apiWorker += apiWorker;
  }

  return { map, scanned: files.length, skipped, totals };
}

/** Check 3 — the request scope must not be reachable from `toApi`. */
function measureSeam() {
  if (!existsSync(join(ROOT, WORKER_ENTRY))) {
    fail(`${WORKER_ENTRY} does not exist — the seam-isolation check cannot run.`);
    return { ok: false, slicedChars: 0, hits: [] };
  }
  const src = read(WORKER_ENTRY);
  const start = src.indexOf("const toApi");
  const end = src.indexOf("const app = new Hono");
  if (start === -1 || end === -1 || end <= start) {
    fail(
      `${WORKER_ENTRY}: could not slice from \`const toApi\` to \`const app = new Hono\` ` +
        `(start=${start}, end=${end}). The seam-isolation matcher is broken — fix the ` +
        `anchors rather than deleting the check.`,
    );
    return { ok: false, slicedChars: 0, hits: [] };
  }
  const slice = src.slice(start, end);
  const re = /REQUEST_SCOPE|innerEnv|requestScope/g;
  const hits = slice.match(re) ?? [];
  return { ok: hits.length === 0, slicedChars: slice.length, hits };
}

const globalUse = measureGlobalUse();
const fanOut = measureFanOut();
const seam = measureSeam();

// ---------------------------------------------------------------------------
// Instrument self-check — an empty result set is a broken matcher, not a pass.
// ---------------------------------------------------------------------------

if (globalUse === 0) {
  fail(
    `${SERVER_INDEX}: matched ZERO \`app.use('*')\` occurrences. That is a broken ` +
      `matcher, not clean code — the global middleware chain is not empty. Fix the ` +
      `pattern before trusting any number this gate prints.`,
  );
}
if (fanOut.scanned === 0) {
  fail(
    `${APP_DIR}/: scanned ZERO .ts/.tsx files. That is a broken walker, not a pass. ` +
      `Scanning nothing always reads as green.`,
  );
}
if (Object.keys(fanOut.map).length === 0) {
  fail(
    `${APP_DIR}/: the fan-out map is EMPTY across ${fanOut.scanned} scanned files. ` +
      `The in-process API call matcher is broken — loaders do call the API.`,
  );
}

// ---------------------------------------------------------------------------
// --update — regenerate the baseline, then exit 0.
// ---------------------------------------------------------------------------

const measuredBaseline = {
  $comment: [
    "Generated by scripts/check-middleware-budget.mjs --update. Do not hand-edit.",
    "fanOut counts are deliberately over-inclusive drift signals, NOT precise call counts.",
    "See the header comment of the script for the three drift vectors this freezes.",
  ],
  globalMiddlewareUse: globalUse,
  fanOutTotals: fanOut.totals,
  fanOut: Object.fromEntries(Object.entries(fanOut.map).sort(([a], [b]) => (a < b ? -1 : 1))),
};

// Check 3 is registered BEFORE the --update path, not with the other console
// output further down. It is the security invariant, and this script advertises
// --update as the remedy for a red run: with the fail() registered later,
// `--update` printed "check 3 … LEAKING" and still exited 0 with a fresh
// baseline, so the documented fix silently accepted the one thing that has no
// baseline. Someone who added a global middleware AND wired the scope into
// toApi would have been told to run --update, and it would have said yes.
if (seam.hits.length > 0) {
  fail(
    `${WORKER_ENTRY}: the toApi slice references ${[...new Set(seam.hits)].join(", ")}. ` +
      `toApi serves EXTERNAL HTTP requests; giving it the request scope would let unrelated ` +
      `requests share memoised auth and tenant decisions. The scope belongs in ssr only. ` +
      `This invariant has no baseline and cannot be re-baselined with --update.`,
  );
}

if (UPDATE) {
  if (failures.length > 0) {
    console.error("Refusing to write a baseline from a broken instrument:\n");
    for (const f of failures) console.error(`  FAIL  ${f}`);
    process.exit(1);
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(measuredBaseline, null, 2)}\n`, "utf8");
  console.log(`middleware budget: wrote baseline -> ${BASELINE_REL}`);
  console.log(`  check 1  global app.use('*') in ${SERVER_INDEX}: ${globalUse}`);
  console.log(
    `  check 2  fan-out under ${APP_DIR}/: ${fanOut.totals.files} tracked files, ` +
      `${fanOut.totals.dollarMethods} $-method refs, ${fanOut.totals.apiWorker} API_WORKER refs ` +
      `(${fanOut.scanned} files scanned, ${fanOut.skipped} test/spec files skipped)`,
  );
  console.log(
    `  check 3  seam isolation in ${WORKER_ENTRY}: ${seam.ok ? "clean" : "LEAKING"} ` +
      `(${seam.slicedChars} chars of toApi slice examined)`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Compare against the baseline.
// ---------------------------------------------------------------------------

if (!existsSync(BASELINE_PATH)) {
  console.error(
    `middleware budget: no baseline at ${BASELINE_REL}. ` +
      `Run: node scripts/check-middleware-budget.mjs --update`,
  );
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const baseGlobalUse = baseline.globalMiddlewareUse ?? 0;
const baseFanOut = baseline.fanOut ?? {};
const baseTotals = baseline.fanOutTotals ?? { files: 0, dollarMethods: 0, apiWorker: 0 };

console.log("middleware budget — measured vs baseline");
console.log("");

// --- Check 1 -------------------------------------------------------------
console.log(`check 1  global app.use('*') in ${SERVER_INDEX}`);
console.log(`         measured ${globalUse}   baseline ${baseGlobalUse}`);
if (globalUse > baseGlobalUse) {
  fail(
    `${SERVER_INDEX}: global app.use('*') count rose to ${globalUse} from a baseline of ` +
      `${baseGlobalUse}. Global middleware is charged once per in-process API call, so a new ` +
      `entry costs the fan-out multiple per page render, not once. If the addition is ` +
      `intended, re-baseline explicitly with --update and say why in the commit message.`,
  );
} else if (globalUse < baseGlobalUse) {
  hints.push(
    `${SERVER_INDEX}: global app.use('*') fell to ${globalUse} from ${baseGlobalUse}. ` +
      `Run --update to tighten the ratchet.`,
  );
}

// --- Check 2 -------------------------------------------------------------
console.log("");
console.log(`check 2  in-process API fan-out under ${APP_DIR}/`);
console.log(
  `         tracked files      measured ${fanOut.totals.files}   baseline ${baseTotals.files ?? 0}`,
);
console.log(
  `         $-method refs      measured ${fanOut.totals.dollarMethods}   baseline ${baseTotals.dollarMethods ?? 0}`,
);
console.log(
  `         API_WORKER refs    measured ${fanOut.totals.apiWorker}   baseline ${baseTotals.apiWorker ?? 0}`,
);
console.log(
  `         scanned ${fanOut.scanned} .ts/.tsx files, skipped ${fanOut.skipped} test/spec files`,
);

const fanOutKeys = new Set([...Object.keys(fanOut.map), ...Object.keys(baseFanOut)]);
const growth = [];
const shrink = [];
for (const key of [...fanOutKeys].sort()) {
  const now = fanOut.map[key] ?? { dollarMethods: 0, apiWorker: 0 };
  const was = baseFanOut[key] ?? { dollarMethods: 0, apiWorker: 0 };
  const isNew = !(key in baseFanOut);
  const isGone = !(key in fanOut.map);
  if (now.dollarMethods > was.dollarMethods || now.apiWorker > was.apiWorker) {
    growth.push({ key, now, was, isNew });
  } else if (now.dollarMethods < was.dollarMethods || now.apiWorker < was.apiWorker) {
    shrink.push({ key, now, was, isGone });
  }
}

for (const { key, now, was, isNew } of growth) {
  console.log(
    `         GROWTH ${key}: $-methods ${now.dollarMethods} (baseline ${was.dollarMethods}), ` +
      `API_WORKER ${now.apiWorker} (baseline ${was.apiWorker})${isNew ? " [new file]" : ""}`,
  );
  fail(
    `${key}: in-process API fan-out grew — $-methods ${now.dollarMethods} vs baseline ` +
      `${was.dollarMethods}, API_WORKER ${now.apiWorker} vs baseline ${was.apiWorker}` +
      `${isNew ? " (this file is not in the baseline at all)" : ""}. Every added in-process ` +
      `call re-runs the entire global middleware chain. If the call is genuinely needed, ` +
      `re-baseline with --update.`,
  );
}
for (const { key, now, was, isGone } of shrink) {
  console.log(
    `         shrink ${key}: $-methods ${now.dollarMethods} (baseline ${was.dollarMethods}), ` +
      `API_WORKER ${now.apiWorker} (baseline ${was.apiWorker})${isGone ? " [file gone]" : ""}`,
  );
}
if (shrink.length > 0) {
  hints.push(
    `${APP_DIR}/: ${shrink.length} file(s) shrank below the baseline. ` +
      `Run --update to tighten the ratchet.`,
  );
}
if (growth.length === 0 && shrink.length === 0) {
  console.log("         no per-file drift");
}

// --- Check 3 -------------------------------------------------------------
console.log("");
console.log(`check 3  seam isolation — request scope must NOT reach toApi (${WORKER_ENTRY})`);
console.log(
  `         measured ${seam.hits.length} match(es) in the toApi slice   baseline 0 (invariant, not ratcheted)`,
);
console.log(`         slice examined: const toApi … const app = new Hono (${seam.slicedChars} chars)`);
if (seam.hits.length > 0) {
  // The failure itself was registered above, before the --update path.
  console.log(`         matches: ${[...new Set(seam.hits)].join(", ")}`);
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

console.log("");
for (const h of hints) console.log(`HINT  ${h}`);
if (hints.length > 0) console.log("");

if (failures.length > 0) {
  console.error(`middleware budget: FAIL (${failures.length} problem(s))`);
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}

console.log("middleware budget: PASS (3 checks, 0 problems)");
