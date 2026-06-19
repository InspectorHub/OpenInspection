#!/usr/bin/env node
/**
 * Design System 0523 conformance guard.
 *
 * Fails (exit 1) when UI code bypasses the token layer with raw Tailwind
 * palette classes. Four rules (see docs of the 2026-06-04 DS conformance
 * remediation):
 *
 *   1. The dead `-bg0` pseudo-token (`ih-(ok|watch|bad|primary)-bg0`) —
 *      generates NO utility, ships invisible elements.
 *   2. Raw palette utilities (`bg-slate-200`, `text-indigo-600`, ...) —
 *      bypass dark mode and the brand hue.
 *   3. Literal `bg-white` / `bg-black` on in-app surfaces.
 *   4. Non-token shadows (`shadow-sm|md|lg|xl|2xl`) — DS defines exactly
 *      two elevations: `shadow-ih-card` and `shadow-ih-popover`.
 *
 * Escape hatches:
 *   - A `ds-allow` comment on the offending line, or within the
 *     ALLOW_WINDOW lines above it (use for fixed-dark surfaces, print
 *     output, email bodies — always state the reason).
 *   - `print:`-variant utilities are ignored (print output is fixed-color
 *     by design).
 *   - Files in FILE_ALLOWLIST are skipped entirely.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SCAN_DIRS = ["app", join("packages", "shared-ui", "src")];

/** Entire files exempt from all rules. Keep this list short and justified. */
const FILE_ALLOWLIST = [
  // Print/PDF output is intentionally fixed-color (no CSS-var theming).
  join("app", "routes", "public", "agreement-printable.tsx"),
  // Email bodies render in external clients with no dark mode / CSS vars.
  join("app", "components", "email-template", "EmailPreview.tsx"),
  // Full-screen photo-annotation studio: fixed-dark chrome in both themes,
  // styled with white-alpha glass utilities throughout. Brand fills inside
  // it ARE tokenized; the neutral on-dark styling is intentional.
  join("app", "components", "editor", "PhotoStudio.tsx"),
  // Media Studio react-konva annotator — same fixed-dark studio chrome as
  // PhotoStudio.tsx (its replacement); neutral on-dark styling is intentional.
  join("app", "components", "media-studio", "PhotoAnnotator.tsx"),
];

/** How many lines above a violation a `ds-allow` comment still excuses it. */
const ALLOW_WINDOW = 10;

const HUES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PREFIXES =
  "bg|text|border|ring|from|to|via|fill|stroke|divide|outline|placeholder|caret|accent|shadow|decoration";

const RULES = [
  { name: "dead -bg0 token", re: new RegExp(`ih-(ok|watch|bad|primary)-bg0`, "g") },
  { name: "raw palette class", re: new RegExp(`\\b(${PREFIXES})-(${HUES})-[0-9]`, "g") },
  { name: "literal bg-white/bg-black", re: /\bbg-(white|black)\b/g },
  { name: "non-token shadow", re: /\bshadow-(sm|md|lg|xl|2xl)\b/g },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(entry)) yield p;
  }
}

const violations = [];

for (const scanDir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, scanDir))) {
    const rel = relative(ROOT, file);
    if (FILE_ALLOWLIST.includes(rel)) continue;

    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((rawLine, i) => {
      // Strip print-variant utilities — fixed-color print output is sanctioned.
      const line = rawLine.replace(/\bprint:[\w[\]/.-]+/g, "");
      for (const rule of RULES) {
        rule.re.lastIndex = 0;
        const m = rule.re.exec(line);
        if (!m) continue;
        // ds-allow on the line itself or within the window above excuses it.
        const from = Math.max(0, i - ALLOW_WINDOW);
        const excused = lines.slice(from, i + 1).some((l) => l.includes("ds-allow"));
        if (!excused) {
          violations.push(`${rel.split(sep).join("/")}:${i + 1}  [${rule.name}]  ${m[0]}`);
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error("Design System conformance check FAILED.\n");
  console.error(
    "Use semantic tokens (bg-ih-bg-card, text-ih-fg-2, border-ih-border, bg-ih-ok, shadow-ih-card/popover, ...).",
  );
  console.error(
    "For sanctioned exceptions (fixed-dark surfaces, print, email bodies) add a `ds-allow: <reason>` comment on or just above the line.\n",
  );
  for (const v of violations) console.error("  " + v);
  console.error(`\n${violations.length} violation(s).`);
  process.exit(1);
}

console.log("DS token conformance: OK");
