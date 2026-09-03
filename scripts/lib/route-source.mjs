/**
 * Reading route registrations out of TypeScript source, for the two routing
 * gates (check-url-taxonomy.mjs, check-route-dispatch-parity.mjs).
 *
 * Two things live here because both gates need them and neither may disagree
 * with the other about what "a mount" is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Comments must be stripped, and stripping them with a regex is worse than
 *    not stripping them at all.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Not stripping is already wrong: a file that names its own mount path in a
 * comment hands the scanner a mount point that does not exist, and the gate
 * then reasons about an address nothing serves.
 *
 * But the obvious fix — one non-greedy block-comment regex — is worse. A Hono
 * wildcard mount ends in the two characters `/` and `*`; inside a string
 * literal that is a path, but to a regex scanning raw text it opens a block
 * comment, and the "comment" then runs to the next `*` + `/` anywhere below,
 * swallowing every real route in between. Silently: the file still parses, the
 * gate still prints a number, and the number is smaller.
 *
 * So `stripComments` is a scanner that knows what a string literal is. It walks
 * the source once, tracking single/double quotes, template literals (including
 * `${...}` interpolations), and regex literals, and only treats `//` or `/*` as
 * a comment when it is genuinely in code position. Comment characters are
 * replaced by spaces rather than deleted, so byte offsets and line numbers
 * survive and a violation can still be reported at its real line.
 *
 * ⚠️ Known limit, stated rather than hidden: a comment written INSIDE a
 * `${...}` interpolation is not stripped. Nothing in this repo does that, and
 * the alternative is a full parser.
 *
 * The callers do not take this on faith. Both gates count mounts before AND
 * after stripping and print the two numbers side by side, plus the literals
 * stripping removed. A tokenizer that starts eating real routes shows up as a
 * route name in that list, which is how the failure above was found the first
 * time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. Mounts are read from registration points only, never from prose.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `collectMounts` matches the first argument of `app.route(...)` /
 * `app.get|post|...(...)` / `app.doc(...)` and of chained `.route(...)`. A path
 * that appears in a comment, in a SQL migration, or in a doc is not a mount and
 * is not this module's business. That is a construction, not an allow-list:
 * allow-lists rot and start suppressing real violations, whereas "only
 * registration points" cannot drift. It is also why neither gate may ever be
 * widened into a full-text grep — several deliberately-kept historical strings
 * in this repo would be indistinguishable from live paths.
 *
 * A mount whose first argument is an identifier rather than a literal (there is
 * one: the QBO OAuth mount is a shared constant so Intuit's redirect_uri has a
 * single source) is resolved by following the import to the module that
 * declares it. An identifier that cannot be resolved is REPORTED, not skipped —
 * an unreadable mount is the one case where the gate must say it went blind.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Characters after which a `/` begins a regex literal rather than a division. */
const REGEX_PRECEDERS = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "~", "^", "<", ">", "\n"]);
/** Keywords after which a `/` begins a regex literal (`return /x/`, `typeof /x/`). */
const REGEX_KEYWORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "do", "else", "yield", "await", "case"]);

function skipString(src, i, quote) {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { j += 2; continue; }
    if (c === quote) return j + 1;
    if (c === "\n") return j; // unterminated; do not run past the line
    j++;
  }
  return src.length;
}

function skipTemplate(src, i) {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "`") return j + 1;
    if (c === "$" && src[j + 1] === "{") { j = skipBraced(src, j + 1); continue; }
    j++;
  }
  return src.length;
}

/** Walk a `{...}` block (a template interpolation), respecting nested strings. */
function skipBraced(src, i) {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === "{") { depth++; j++; continue; }
    if (c === "}") { depth--; j++; if (depth === 0) return j; continue; }
    if (c === '"' || c === "'") { j = skipString(src, j, c); continue; }
    if (c === "`") { j = skipTemplate(src, j); continue; }
    j++;
  }
  return src.length;
}

/** Returns the index past a regex literal starting at `i`, or `i` if it is not one. */
function skipRegex(src, i) {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "\n") return i;
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      j++;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      return j;
    }
    j++;
  }
  return i;
}

/**
 * Replace every comment with spaces, preserving length, offsets and newlines.
 * String and template literals and regex literals are left untouched.
 */
export function stripComments(source) {
  const out = source.split("");
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };

  let i = 0;
  let prev = "";      // last significant code character
  let prevWord = "";  // last identifier/keyword, for `return /re/`

  while (i < source.length) {
    const c = source[i];
    const d = source[i + 1];

    if (c === "/" && d === "/") {
      let j = i;
      while (j < source.length && source[j] !== "\n") j++;
      blank(i, j);
      prev = "\n"; prevWord = "";
      i = j;
      continue;
    }
    if (c === "/" && d === "*") {
      const close = source.indexOf("*/", i + 2);
      const j = close === -1 ? source.length : close + 2;
      blank(i, j);
      prev = "\n"; prevWord = "";
      i = j;
      continue;
    }
    if (c === '"' || c === "'") { i = skipString(source, i, c); prev = c; prevWord = ""; continue; }
    if (c === "`") { i = skipTemplate(source, i); prev = "`"; prevWord = ""; continue; }
    if (c === "/" && (REGEX_PRECEDERS.has(prev) || REGEX_KEYWORDS.has(prevWord))) {
      const j = skipRegex(source, i);
      if (j > i) { i = j; prev = "/"; prevWord = ""; continue; }
    }

    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_$]/.test(source[j])) j++;
      prevWord = source.slice(i, j);
      prev = source[j - 1];
      i = j;
      continue;
    }
    if (!/\s/.test(c)) { prev = c; prevWord = ""; }
    else if (c === "\n") { prev = "\n"; prevWord = ""; }
    i++;
  }
  return out.join("");
}

/**
 * Route registrations: `app.<verb>(<first arg>` and chained `.route(<first arg>`.
 * The receiver is pinned to `app.` (or a bare `.route(`) on purpose — an
 * unanchored `.get(` would collect `c.get('tenantId')` and `map.get(...)` as
 * mount paths.
 */
const MOUNT_RE = /(?:\bapp\.(route|doc|all|get|post|put|patch|delete)|\.(route))\s*\(\s*(?:(['"])([^'"]*)\3|([A-Za-z_$][\w$]*))/g;

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

/**
 * Resolve an identifier used as a mount path back to its declared literal by
 * following the import in `file` to the module that exports it.
 * @returns {{ value: string } | { error: string }}
 */
function resolveConstant(identifier, file, source) {
  const importRe = new RegExp(`import\\s*\\{[^}]*\\b${identifier}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`);
  const hit = source.match(importRe);
  if (!hit) return { error: `no import declares ${identifier}` };

  const base = resolve(dirname(file), hit[1]);
  const candidate = [`${base}.ts`, `${base}.mjs`, resolve(base, "index.ts")].find((p) => existsSync(p));
  if (!candidate) return { error: `cannot locate the module '${hit[1]}' that exports ${identifier}` };

  const declared = readFileSync(candidate, "utf8")
    .match(new RegExp(`export\\s+const\\s+${identifier}\\s*(?::[^=]+)?=\\s*['"]([^'"]+)['"]`));
  if (!declared) return { error: `${identifier} is not a string constant in ${hit[1]}` };
  return { value: declared[1] };
}

/**
 * Collect the mount points a file registers.
 *
 * @param {string} file absolute path (used for import resolution and reporting)
 * @param {string} rawSource the file's text, comments included
 * @param {string} label the path to print in violations
 * @returns {{ mounts: Array, raw: Array, dropped: string[], unresolved: Array }}
 *   `mounts` are from comment-stripped source; `raw` from the source as written.
 *   `dropped` names the literals that stripping removed — the number a human
 *   checks to confirm stripping ate comments and not routes.
 */
export function collectMounts(file, rawSource, label) {
  const scan = (text) => {
    const found = [];
    const unresolved = [];
    for (const m of text.matchAll(MOUNT_RE)) {
      const kind = (m[1] ?? m[2]) === "route" ? "prefix" : "exact";
      const line = lineOf(text, m.index);
      if (m[4] !== undefined) {
        found.push({ file: label, path: m[4], kind, line, via: "literal" });
        continue;
      }
      const resolved = resolveConstant(m[5], file, text);
      if ("error" in resolved) {
        unresolved.push({ file: label, identifier: m[5], line, why: resolved.error });
        continue;
      }
      found.push({ file: label, path: resolved.value, kind, line, via: m[5] });
    }
    return { found, unresolved };
  };

  const strippedRun = scan(stripComments(rawSource));
  const rawRun = scan(rawSource);

  const keep = new Set(strippedRun.found.map((x) => `${x.path}@${x.line}`));
  const dropped = rawRun.found
    .filter((x) => !keep.has(`${x.path}@${x.line}`))
    .map((x) => `${x.path} (${label}:${x.line})`);

  return { mounts: strippedRun.found, raw: rawRun.found, dropped, unresolved: strippedRun.unresolved };
}

/** Read a source file for the gates, with a clear failure if it has moved. */
export function readSource(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/** Repo root, from a script in `scripts/` or `scripts/lib/`. */
export const repoRoot = (importMetaUrl, up) =>
  new URL(up, importMetaUrl).pathname.replace(/^\/([A-Za-z]:)/, "$1");
