/**
 * Source scanning for the small-text contrast gate (`scripts/check-contrast.mjs`).
 *
 * Split out of the gate because the gate grew a second job — working out which
 * SURFACE a piece of text is drawn on — and the two concerns read badly
 * interleaved. This file knows about JavaScript syntax and Tailwind class
 * strings; it knows nothing about colours.
 *
 * ── Why a real lexer and not two regex passes ──
 * The previous scanner blanked comments with `/\/\*[\s\S]*?\*\//g` and then
 * matched quoted strings. Both passes are blind to each other, and that is not
 * a theoretical problem:
 *
 *   `https://*.inspectorhub.io/book/<slug>?ref=${slug}`   (agent/settings-profile)
 *
 * The `/​*` inside that URL glob opened a phantom block comment that ran to the
 * next `*​/` further down the file, blanking real markup on the way and leaving
 * an unbalanced quote behind it. The result was four bogus reports pointing at
 * one line, plus silent loss of coverage over everything the phantom swallowed.
 * The same class of bug is already documented for apostrophes ("the card's
 * overflow"). Two regexes cannot fix each other; one left-to-right pass can.
 *
 * The lexer also has to know a regex literal from a division, because a regex
 * like /["']/ otherwise opens a phantom string. It uses the standard
 * previous-significant-token heuristic, which is what every JS tokenizer does.
 */

/**
 * Chars after which a `/` may legitimately open a REGEX LITERAL.
 *
 * This is a whitelist, not the usual "anything but an operand" blacklist,
 * because these are TSX files and the usual heuristic is wrong three separate
 * ways in JSX: `</kbd>`, `<span> / <span>` and `{expr}</td>` all put a `/`
 * after a character the blacklist reads as "expression position". Each one then
 * swallows everything up to the next `/` — which, measured on this tree, ate
 * four real className strings including two whole `<kbd>` elements.
 *
 * Regex recognition cannot simply be dropped: `/https?:\/\//` contains a `//`
 * that would otherwise start a line comment. So it stays, narrowed to the
 * positions where a regex is the only thing a `/` can be.
 */
const REGEX_PREDECESSOR = /[(,=:!&|?{;+*%^~[]/;

/**
 * One left-to-right pass over a JS/TSX source.
 *
 * Returns `{ strings, comments }`, each entry `{ text, line }` with a 1-based
 * line. `strings` carries the literal's BODY (quotes removed, `${…}`
 * substitutions blanked, since a runtime value is not a class name we can read).
 */
export function lex(source) {
  const strings = [];
  const comments = [];
  let line = 1;
  let prev = ""; // last significant (non-space) character seen
  let i = 0;

  const countLines = (s) => {
    for (const c of s) if (c === "\n") line++;
  };

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }

    // ── line comment ──
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      comments.push({ text: source.slice(i + 2, stop), line });
      i = stop;
      continue;
    }

    // ── block comment ──
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      const body = source.slice(i, stop);
      comments.push({ text: source.slice(i + 2, stop - 2), line });
      countLines(body);
      i = stop;
      continue;
    }

    // ── regex literal ──
    if (ch === "/" && REGEX_PREDECESSOR.test(prev)) {
      let j = i + 1;
      let cls = false;
      let closed = false;
      while (j < source.length) {
        const c = source[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === "\n") break; // unterminated — it was division after all
        if (c === "[") cls = true;
        else if (c === "]") cls = false;
        else if (c === "/" && !cls) {
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        i = j + 1;
        prev = "/";
        continue;
      }
      // fall through: treat as an ordinary character
    }

    // ── string / template literal ──
    if (ch === '"' || ch === "'" || ch === "`") {
      const startLine = line;
      let j = i + 1;
      let body = "";
      let depth = 0; // `${…}` nesting inside a template
      while (j < source.length) {
        const c = source[j];
        if (c === "\\") {
          body += "  ";
          j += 2;
          continue;
        }
        if (ch === "`" && c === "$" && source[j + 1] === "{") {
          depth = 1;
          j += 2;
          body += " ";
          while (j < source.length && depth > 0) {
            if (source[j] === "{") depth++;
            else if (source[j] === "}") depth--;
            else if (source[j] === "\n") line++;
            j++;
          }
          continue;
        }
        if (c === ch) break;
        // A newline ends a single/double-quoted literal in practice: real code
        // does not contain one, so seeing it means we mis-identified the quote
        // (an apostrophe in prose). Stop rather than swallow the rest of the file.
        if (c === "\n") {
          if (ch !== "`") break;
          line++;
        }
        body += c;
        j++;
      }
      strings.push({ text: body, line: startLine });
      i = j + 1;
      prev = ch;
      continue;
    }

    prev = ch;
    i++;
  }

  return { strings, comments };
}

/** String literals that could plausibly be a class list, with 1-based lines. */
export function classChunks(source) {
  return lex(source)
    .strings.filter((s) => s.text.includes("text-"))
    .map((s) => ({ text: s.text, line: s.line }));
}

const NAMED_SIZES = { "text-xs": 12, "text-sm": 14, "text-base": 16, "text-lg": 18 };

/** Smallest text size a class string sets, in px, or null if it sets none. */
export function smallestSize(chunk) {
  const found = [];
  for (const [util, px] of Object.entries(NAMED_SIZES)) {
    if (new RegExp(`(?<![-:\\w])${util}(?![\\w-])`).test(chunk)) found.push(px);
  }
  for (const m of chunk.matchAll(/(?<![-:\w])text-\[(\d+(?:\.\d+)?)px\]/g)) found.push(Number(m[1]));
  return found.length ? Math.min(...found) : null;
}

/**
 * Unprefixed `text-ih-*` foregrounds in a class string. Variant-prefixed
 * utilities (`hover:`, `placeholder:`, `print:`) are skipped — a placeholder or
 * a hover tint is not the resting state of body copy.
 */
export function foregroundTokens(chunk) {
  return [...chunk.matchAll(/(?<![-:\w])text-ih-([a-z0-9-]+)(?![\w-])/g)].map((m) => m[1]);
}

/**
 * Unprefixed `bg-ih-*` backgrounds in a class string — the surface the element
 * paints for ITSELF.
 *
 * Unprefixed for the same reason foregrounds are: `hover:bg-ih-bg-muted` is not
 * the resting surface, and reading it as one would score every list row against
 * a background it only has while the pointer is over it.
 */
export function backgroundTokens(chunk) {
  const seen = [...chunk.matchAll(/(?<![-:\w])bg-ih-([a-z0-9-]+)(?![\w-])/g)].map((m) => m[1]);
  return [...new Set(seen)];
}

/**
 * Which surface a class string is drawn on.
 *
 * Returns `{ prop, origin }`, or `{ unresolved: <why> }` when no single colour
 * can be named. It never guesses: an unresolved surface is reported as
 * unresolved rather than quietly replaced with the default, because a surface
 * we invented is how a gate ends up confidently measuring the wrong thing.
 */
export function resolveSurface({ chunk, alias, annotation, reference }) {
  const named = annotation
    ? { token: annotation.token, origin: "annotation" }
    : (() => {
        // An alpha modifier makes the surface a blend with whatever is behind
        // it, which is exactly the thing we cannot see.
        if (/(?<![-:\w])bg-ih-[a-z0-9-]+\/\d/.test(chunk)) return { alpha: true };
        const bgs = backgroundTokens(chunk);
        if (bgs.length === 0) return null;
        if (bgs.length > 1) return { ambiguous: bgs };
        return { token: bgs[0], origin: "element" };
      })();

  if (named?.alpha) return { unresolved: "background has an alpha modifier" };
  if (named?.ambiguous) {
    return { unresolved: `two backgrounds on one element (${named.ambiguous.join(", ")})` };
  }
  if (!named) return { prop: reference, origin: "default" };

  const prop = alias.get(named.token);
  if (!prop) return { unresolved: `bg-ih-${named.token} is not in the @theme block` };
  return { prop, origin: named.origin, token: named.token };
}

/** `contrast-surface: bg-ih-<token>` — the call-site surface override. */
const ANNOTATION = /contrast-surface:\s*(bg-ih-[a-z0-9-]+)/;

/**
 * Surface annotations by line, read from COMMENTS only.
 *
 * An annotation applies to the class string on its own line or on any of the
 * next two lines, which covers `// contrast-surface: bg-ih-primary` sitting
 * above a `className=` and `{/* contrast-surface: … *​/}` sitting above a JSX
 * element whose attributes start on the following line.
 *
 * It exists for the one thing this scanner genuinely cannot work out on its
 * own: text painted by an ANCESTOR's background. It is not a mute button — an
 * annotation on a site that already passes is reported as an error, so it
 * cannot outlive the pairing it explains.
 */
export function surfaceAnnotations(source) {
  const map = new Map();
  for (const c of lex(source).comments) {
    const m = ANNOTATION.exec(c.text);
    if (!m) continue;
    const token = m[1].slice("bg-ih-".length);
    const span = c.text.split("\n").length - 1;
    for (let d = 0; d <= 2; d++) map.set(c.line + span + d, { token, line: c.line });
  }
  return map;
}
