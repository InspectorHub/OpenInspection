/**
 * The printing half of `scripts/check-contrast.mjs` — what a run SAYS.
 *
 * Separated from the measuring half so the numbers can be asserted in a spec
 * without capturing stdout, and so the one rule this output has to obey stays in
 * one readable place: BOTH numbers, every run, pass or fail. A gate that prints
 * only a verdict cannot be audited on the day it goes green, and the skipped
 * tallies are the part that says how much the verdict is worth.
 *
 * Returns a process exit code; it never calls `process.exit` itself.
 */
import { AA_NORMAL, THEMES, aliasMap } from "./contrast-css.mjs";
import { AA_LARGE, PALETTE_DEBT, TOKEN_INVARIANTS } from "./palette-invariants.mjs";
import { KNOWN_DEBT } from "./contrast-gate.mjs";

/** @param r the object `findViolations` returned. */
export function reportFindings(r, { css, cssPath }) {
  if (r.checked === 0) {
    console.error(
      "check-contrast: matched ZERO small-text colour utilities. The scanner is " +
        "broken or the scan dirs moved — a gate that sees nothing passes everything.",
    );
    return 1;
  }

  for (const v of r.violations) {
    console.error(`\n${v.path}:${v.line}  text-ih-${v.token} at ${v.size}px`);
    console.error(`  ${v.snippet}`);
    console.error(`  surface ${v.surface} (${v.origin})`);
    for (const f of v.failures) {
      console.error(
        `  ${f.theme}: ${f.fg} on ${f.bg} = ${f.ratio.toFixed(2)}:1 (need ${AA_NORMAL}:1)`,
      );
    }
  }
  for (const a of r.uselessAnnotations) {
    console.error(`\n${a.path}:${a.line}  contrast-surface: bg-ih-${a.token} is not needed`);
    console.error(`  ${a.snippet}`);
    console.error("  This site clears AA without it. Delete the annotation.");
  }
  for (const d of r.staleDebt) {
    console.error(`\nStale KNOWN_DEBT entry — no longer matches ${d.file}:`);
    console.error(`  ${d.match}\n  Remove it from scripts/check-contrast.mjs.`);
  }
  for (const a of r.aliasFailures) {
    console.error(
      `\n@theme alias --color-ih-${a.name} points at ${a.prop}, which is not ` +
        `declared in: ${a.themes.join(", ")}.`,
    );
    console.error(
      a.fallback
        ? `  The alias falls back to ${a.fallback}, so every call site renders THAT in ` +
            "every theme — and nothing measures it, because the token resolves to nothing. " +
            `Declare ${a.prop} per theme.`
        : `  Every \`*-ih-${a.name}\` utility compiles to an invalid value. Declare ${a.prop} per theme.`,
    );
  }
  for (const f of r.cssRules.failures) {
    console.error(
      `\n${cssPath}:${f.line}  ${f.selector} — color: var(${f.fg})` +
        (f.sizePx === null ? " at an unknown size" : ` at ${f.sizePx}px (${f.sizeFrom})`),
    );
    console.error(
      `  ${f.theme}: ${f.fgHex} on ${f.bgHex} (${f.bgProp}) = ${f.ratio.toFixed(2)}:1 ` +
        `(need ${f.threshold}:1` +
        (f.threshold === AA_LARGE ? " — below this no size can rescue it)" : ")"),
    );
  }
  for (const t of r.tokenFailures) {
    console.error(
      `\nToken invariant broken — ${t.fg} on ${t.bg} (${t.theme}): ` +
        (t.ratio === null
          ? `one side is not a hex colour (${t.fgHex} / ${t.bgHex}).`
          : `${t.fgHex} on ${t.bgHex} = ${t.ratio.toFixed(2)}:1 (need ${AA_NORMAL}:1).`),
    );
    console.error(`  ${t.why}`);
  }
  for (const p of r.stalePalette) {
    console.error(
      `\nStale PALETTE_DEBT entry — ${p.fg} on ${p.bg} (${p.theme}) is no longer ` +
        `a failure measuring ${p.ratio}:1.`,
    );
    console.error("  The palette moved. Re-take the decision, then update or remove the entry.");
  }

  // ── BOTH NUMBERS, every run, pass or fail ──
  // A skipped site is not a checked site, and the only thing worse than a gate
  // that misses something is a gate that misses it silently. Printing the
  // skipped tallies next to the checked counts is what makes a green run
  // auditable on the day it is green rather than months later.
  // `bg-ih-… is not in the @theme block` in particular is never benign: that
  // class compiles to nothing at all, so the element paints no background and
  // Tailwind says nothing about it.
  const tallyOf = (rows, key) => {
    const t = new Map();
    for (const row of rows) t.set(row[key], (t.get(row[key]) ?? 0) + 1);
    return [...t].sort((a, b) => b[1] - a[1]);
  };
  console.log(
    `check-contrast: CHECKED ${r.checked} class-string colour(s) ` +
      `(${r.fromContext} of them sized by the template literal around them), ` +
      `${r.cssRules.checked} stylesheet rule(s), ` +
      `${TOKEN_INVARIANTS.length} token invariant(s), ` +
      `${aliasMap(css).size} @theme alias declaration(s).`,
  );
  console.log(
    `check-contrast: SKIPPED ${r.sizeless.length} colour(s) with no size anywhere, ` +
      `${r.unresolved.length} unresolvable surface(s), ` +
      `${r.unmeasurable.length} unmeasurable theme pairing(s), ` +
      `${r.cssRules.skipped.length} stylesheet rule measurement(s).`,
  );
  for (const [why, n] of tallyOf(r.unresolved, "why")) console.log(`  skipped: ${n}x ${why}`);
  for (const [why, n] of tallyOf(r.cssRules.skipped, "why")) console.log(`  skipped (css): ${n}x ${why}`);
  if (r.unmeasurable.length) {
    const t = new Map();
    for (const u of r.unmeasurable) {
      const k = `text-ih-${u.token} vs ${u.bg}`;
      t.set(k, (t.get(k) ?? 0) + 1);
    }
    for (const [k, n] of [...t].sort((a, b) => b[1] - a[1])) {
      console.log(`  unmeasurable: ${n}x ${k}`);
    }
  }
  if (r.sizeless.length) {
    const t = new Map();
    for (const s of r.sizeless) for (const tok of s.tokens) t.set(tok, (t.get(tok) ?? 0) + 1);
    for (const [tok, n] of [...t].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`  no size: ${n}x text-ih-${tok}`);
    }
  }

  const bad =
    r.violations.length +
    r.staleDebt.length +
    r.stalePalette.length +
    r.uselessAnnotations.length +
    r.tokenFailures.length +
    r.aliasFailures.length +
    r.cssRules.failures.length;
  if (bad > 0) {
    console.error(
      `\n✖ check-contrast: ${r.violations.length} contrast failure(s), ` +
        `${r.cssRules.failures.length} stylesheet-rule failure(s), ` +
        `${r.aliasFailures.length} undeclared @theme alias target(s), ` +
        `${r.tokenFailures.length} broken token invariant(s), ` +
        `${r.uselessAnnotations.length} unnecessary annotation(s), ` +
        `${r.staleDebt.length + r.stalePalette.length} stale exemption(s).`,
    );
    console.error(
      `  Small helper text must clear ${AA_NORMAL}:1 on the surface it is drawn on. ` +
        "For hints on a card that means text-ih-fg-3 (not fg-4); on bg-ih-bg-muted " +
        "even fg-3 is only 4.34:1, so use text-ih-fg-2 there.",
    );
    return 1;
  }
  console.log(
    `✓ check-contrast: ${r.checked} small-text colour(s) and ${r.cssRules.checked} ` +
      `stylesheet rule(s) clear their threshold in ${THEMES.length} themes, plus ` +
      `${TOKEN_INVARIANTS.length} token invariant(s) and every @theme alias target ` +
      `declared (${KNOWN_DEBT.length} site exemption(s), ${PALETTE_DEBT.length} ` +
      "palette exemption(s)). The SKIPPED line above is part of the result.",
  );
  console.log(
    "  Not covered, and not coverable here: a TENANT's brand colour. It lives in " +
      "the database, arrives as an inline style at request time, and never appears " +
      "in this stylesheet — so 63.6% of sRGB, the share that fails AA as brand-" +
      "coloured text on white, is invisible to every static gate. That share is " +
      "held by app/lib/brand.ts (`brandTextColor`) and pinned by a property test " +
      "over the sRGB cube in app/lib/brand.test.ts. A green run here says nothing " +
      "about it.",
  );
  return 0;
}
