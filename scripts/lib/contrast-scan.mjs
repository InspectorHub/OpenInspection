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
 *
 * A template literal additionally carries `parts`: the string literals found
 * INSIDE its `${…}` substitutions, flattened, with absolute lines. They used to
 * be dropped entirely — the substitution was skipped character by character and
 * nothing inside it was ever lexed — which is the whole reason the "assembled
 * from several literals" blind spot existed. The common shape is a ternary:
 *
 *   `… text-[10px] … ${active ? "bg-ih-primary-tint …" : "bg-ih-bg-muted text-ih-fg-4"}`
 *
 * The size is in the template, the colour and the surface are in a branch, and
 * neither half is measurable on its own. Emitting the branches as `parts` lets
 * the gate pair them back up with the template that contains them.
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
      const parts = [];
      while (j < source.length) {
        const c = source[j];
        if (c === "\\") {
          body += "  ";
          j += 2;
          continue;
        }
        if (ch === "`" && c === "$" && source[j + 1] === "{") {
          depth = 1;
          const interpLine = line;
          j += 2;
          const interpStart = j;
          body += " ";
          while (j < source.length && depth > 0) {
            if (source[j] === "{") depth++;
            else if (source[j] === "}") depth--;
            else if (source[j] === "\n") line++;
            j++;
          }
          // `j` now sits one past the closing `}` (or at EOF). Re-lex the
          // substitution's source so its own string literals, comments and
          // nested templates are seen instead of skipped. Recursion is bounded
          // by the slice shrinking on every level.
          const interpEnd = Math.max(interpStart, j - 1);
          const off = interpLine - 1;
          const inner = lex(source.slice(interpStart, interpEnd));
          for (const s of inner.strings) {
            parts.push({ text: s.text, line: s.line + off });
            for (const p of s.parts ?? []) parts.push({ text: p.text, line: p.line + off });
          }
          for (const cm of inner.comments) comments.push({ text: cm.text, line: cm.line + off });
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
      strings.push({ text: body, line: startLine, parts });
      i = j + 1;
      prev = ch;
      continue;
    }

    prev = ch;
    i++;
  }

  return { strings, comments };
}

/**
 * String literals that could plausibly be a class list, with 1-based lines.
 *
 * Each entry also carries `context`: for a fragment that lives inside a template
 * literal's `${…}`, the ENCLOSING template's body. The gate reads a missing size
 * or a missing surface out of it, because in an assembled class string the two
 * halves are routinely in different literals. `context` is null for a top-level
 * literal.
 */
export function classChunks(source) {
  const out = [];
  for (const s of lex(source).strings) {
    if (s.text.includes("text-")) out.push({ text: s.text, line: s.line, context: null });
    for (const p of s.parts ?? []) {
      if (p.text.includes("text-")) out.push({ text: p.text, line: p.line, context: s.text });
    }
  }
  return out;
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
  // An alpha modifier makes the surface a blend with whatever is behind it,
  // which is exactly the thing we cannot see.
  const alpha = /(?<![-:\w])bg-ih-[a-z0-9-]+\/\d/.test(chunk);
  const bgs = backgroundTokens(chunk);
  // The element's OWN resting background, when it names exactly one and that one
  // is readable, and it OUTRANKS an annotation. The annotation exists for the one
  // thing this scanner cannot work out — the surface an ANCESTOR paints — so
  // where the element paints its own there is nothing left to override.
  //
  // The precedence matters because a ternary's two branches sit on ONE line, and
  // an annotation is keyed by line, so it necessarily covers both. The photo
  // studio toolbar is the case: the inactive branch needs the fixed-dark chrome
  // named, while the active branch carries `bg-ih-primary` itself — and letting
  // the annotation win there would have scored the dark theme's near-black
  // `--ih-fg-inverse` against a near-black chrome at 1.00:1, inventing a failure
  // out of an override meant to remove one.
  const own = !alpha && bgs.length === 1 ? bgs[0] : null;

  const resolveToken = (token, origin) => {
    const prop = alias.get(token);
    if (!prop) return { unresolved: `bg-ih-${token} is not in the @theme block` };
    return { prop, origin, token };
  };

  if (own !== null) return resolveToken(own, "element");
  if (annotation) {
    // A literal hex annotation, for a surface no token describes: the photo
    // studio chrome is `style={{ background: "rgba(15,23,42,0.85)" }}` and stays
    // dark in every theme, so no `bg-ih-*` is honest about it. Measured against
    // that one colour in all three themes, which is what the element does.
    if (annotation.token.startsWith("#")) {
      return { hex: annotation.token, origin: "annotation", token: annotation.token };
    }
    return resolveToken(annotation.token, "annotation");
  }
  if (alpha) return { unresolved: "background has an alpha modifier" };
  if (bgs.length > 1) return { unresolved: `two backgrounds on one element (${bgs.join(", ")})` };
  return { prop: reference, origin: "default" };
}

/**
 * `contrast-surface: bg-ih-<token>` — or `contrast-surface: #0f172a` for a
 * surface no design token describes (a fixed-dark chrome painted by an inline
 * style). The call-site surface override.
 */
const ANNOTATION = /contrast-surface:\s*(bg-ih-[a-z0-9-]+|#[0-9a-fA-F]{3,6}\b)/;

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
    const token = m[1].startsWith("#") ? m[1] : m[1].slice("bg-ih-".length);
    const span = c.text.split("\n").length - 1;
    for (let d = 0; d <= 2; d++) map.set(c.line + span + d, { token, line: c.line });
  }
  return map;
}
