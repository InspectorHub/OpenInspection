#!/usr/bin/env node
/**
 * Signature-verification guard.
 *
 * Fails (exit 1) when a function that verifies a signature does not reach an
 * approved constant-time comparison.
 *
 * Why a gate and not a test: these verifiers are internet-reachable, and a
 * timing-safe comparison and a `===` behave IDENTICALLY under test. Both accept
 * the right signature and reject the wrong one. Nothing a unit test can observe
 * distinguishes them, so a regression from `crypto.subtle.verify` back to a
 * string compare would leave every suite green — which is exactly what happened
 * to `services/qbo/webhook.ts` before it was found by reading.
 *
 * The rule is POSITIVE — "must use an approved primitive" — rather than a ban on
 * `===`. Banning the operator would fail on the first comment that explains why
 * it must not be used, and this repository has one: the note above the QBO
 * verifier quotes the very expression it replaced. A grep gate has no AST and
 * cannot tell the explanation from the offence.
 *
 * Approved mechanisms:
 *   - `crypto.subtle.verify`      — the WebCrypto path, constant-time by contract
 *   - `constantTimeEquals`        — server/lib/email/webhook-crypto.ts
 *   - delegation to another verifier (a file may simply route to one)
 *
 * Escape hatch: a `sigcompare-allow: <reason>` comment on the declaration line
 * or within ALLOW_WINDOW lines above it. State the reason.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SCAN_DIRS = ["server"];

/** How many lines above a declaration a `sigcompare-allow` comment still excuses it. */
const ALLOW_WINDOW = 6;

/**
 * Declarations this gate is about — a name that says it verifies a signature is
 * a promise about what the body does.
 *
 * Two things it must NOT match, both of which the first draft did:
 *   - CALL SITES (`await verifyInboundSignature(c, opts)`, `adapter.verifyX(ctx)`).
 *     Hence the anchored prefix: nothing may precede the name on the line except
 *     declaration keywords.
 *   - INTERFACE MEMBERS (`verifyWebhookSignature(ctx): Promise<boolean>;`).
 *     They have no body to inspect; the implementations are checked instead.
 *     Discriminated below by whether a `{` or a `;` closes the declaration.
 */
const DECLARATION =
  /^\s*(?:export\s+)?(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?(?:function\s+)?((?:verify|validate|check)[A-Za-z]*Signature)\s*\(/;

/** How far past a declaration to look for the `{` or `;` that classifies it. */
const CLASSIFY_WINDOW = 12;

/** True when the declaration opens a body rather than ending an interface member. */
function hasBody(lines, i) {
  const text = lines.slice(i, i + CLASSIFY_WINDOW).join("\n");
  const afterName = text.indexOf("(");
  if (afterName < 0) return false;
  const rest = text.slice(afterName);
  const brace = rest.indexOf("{");
  const semi = rest.indexOf(";");
  if (brace < 0) return false;
  return semi < 0 || brace < semi;
}

/** Any of these in the same file satisfies the requirement. */
const APPROVED = [
  { name: "crypto.subtle.verify", re: /crypto\.subtle\.verify\s*\(/ },
  { name: "constantTimeEquals", re: /\bconstantTimeEquals\s*\(/ },
];

/** A call to some OTHER verifier — delegation, which is fine. */
const DELEGATES = /\b(?:verify|validate|check)[A-Za-z]*Signature\s*\(/g;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(name)) yield full;
  }
}

/** Strip line and block comments so prose about `===` never counts as code. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

const violations = [];
let filesScanned = 0;
let declarationsFound = 0;

for (const scanDir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, scanDir))) {
    filesScanned++;
    const rel = relative(ROOT, file).split(sep).join("/");
    const raw = readFileSync(file, "utf8");
    const lines = raw.split("\n");
    const code = stripComments(raw);

    const satisfied = APPROVED.filter((a) => a.re.test(code));
    // Two or more distinct verifier names in the code means at least one call
    // is to something other than the declaration itself: delegation.
    const names = new Set((code.match(DELEGATES) ?? []).map((s) => s.replace(/\s*\($/, "")));
    const delegates = names.size > 1;

    lines.forEach((line, i) => {
      const m = DECLARATION.exec(stripComments(line));
      if (!m) return;
      // An interface member promises nothing about a comparison — its
      // implementations are separately in scope and are what get checked.
      if (!hasBody(lines, i)) return;
      declarationsFound++;
      if (satisfied.length > 0 || delegates) return;

      const from = Math.max(0, i - ALLOW_WINDOW);
      const excused = lines.slice(from, i + 1).some((l) => l.includes("sigcompare-allow"));
      if (!excused) {
        violations.push(`${rel}:${i + 1}  ${m[1]}() reaches no approved constant-time comparison`);
      }
    });
  }
}

// Both numbers, always. A gate that scanned nothing, or found nothing to check,
// has no business reporting OK — it would then be green for the rest of time
// precisely because it stopped working.
if (filesScanned === 0) {
  console.error(
    `Signature-verification guard: scanned 0 files across ${SCAN_DIRS.join(", ")} — ` +
      "the scan dirs are wrong or the walk is broken. Refusing to report OK.",
  );
  process.exit(1);
}
if (declarationsFound === 0) {
  console.error(
    `Signature-verification guard: scanned ${filesScanned} file(s) and found 0 signature ` +
      "verifiers. This codebase has several, so the declaration pattern no longer matches " +
      "what they are called. Refusing to report OK.",
  );
  process.exit(1);
}

if (violations.length > 0) {
  console.error("Signature-verification guard FAILED.\n");
  console.error(
    "A signature comparison must be constant time. `a === b` returns on the first differing",
  );
  console.error(
    "byte, and on an internet-reachable verifier that difference is measurable. No test can",
  );
  console.error("see this: both forms accept the right signature and reject the wrong one.\n");
  console.error("Use one of:");
  for (const a of APPROVED) console.error(`  - ${a.name}`);
  console.error("  - or delegate to another verifier\n");
  console.error(
    "For a sanctioned exception add a `sigcompare-allow: <reason>` comment on or above the line.\n",
  );
  for (const v of violations) console.error("  " + v);
  console.error(`\n${violations.length} violation(s).`);
  process.exit(1);
}

console.log(
  `Signature-verification guard: OK — ${declarationsFound} verifier(s) checked across ` +
    `${filesScanned} file(s) in ${SCAN_DIRS.join(", ")}`,
);
