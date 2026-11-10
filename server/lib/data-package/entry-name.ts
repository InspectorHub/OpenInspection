import { DataPackageFormatError } from './errors';

/**
 * Entry-name rules shared by every parser and writer in this directory. An entry name is attacker-controlled
 * text on import, so the rules are an allowlist, not a denylist. Kept free of imports from the other
 * modules so `shard.ts` and `volume.ts` can both use it without a cycle.
 *
 * Two consequences the EXPORTER must handle (documented here rather than relaxed, because both rules protect
 * an extraction on a case-insensitive, non-UTF-8-safe disk):
 *  - Names are compared case-folded (`entryNameFoldKey`), so two legitimate R2 keys that differ only by case
 *    (`photos/A.jpg` and `photos/a.jpg`) count as duplicates and the package is refused. The exporter must
 *    detect such keys while listing and either rename one (recording the mapping in `media/index.json`) or
 *    exclude it with an `excluded` entry; it must never write both.
 *  - The allowlist is ASCII only (`A-Za-z0-9._@+=,~() -`, space only inside a segment). An R2 key with any other
 *    character (non-ASCII letters, `%`, `#`, `:`, `&`, ...) cannot be a zip entry name as it stands: the
 *    exporter must map it to a safe name (again recorded in `media/index.json`) or exclude it. The importer
 *    restores keys under a new tenant prefix from that mapping, never from the entry name.
 */
const MAX_ENTRY_NAME_BYTES = 512;
const MAX_ENTRY_SEGMENT_BYTES = 255;
const MAX_ENTRY_SEGMENTS = 12;

/** Space is allowed inside a segment (never at either end); backslash, colon, wildcards, % # and every non-ASCII byte are not. */
const SEGMENT_RE = /^[A-Za-z0-9._@+=,~()-](?:[A-Za-z0-9._@+=,~() -]*[A-Za-z0-9_@+=,~()-])?$/;
/**
 * Names Windows treats as devices even with an extension and even with spaces before the dot
 * (`con .txt` is `con`). An extracted package must not hit them.
 */
const WINDOWS_DEVICE_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])[ ]*(?:\..*)?$/i;

/** A short reason the name is unsafe, or `null` when it is a safe relative entry name. */
export function entryNameProblem(name: string): string | null {
  if (name.length === 0) return 'empty';
  if (name.length > MAX_ENTRY_NAME_BYTES) return 'too long';
  const segments = name.split('/');
  if (segments.length > MAX_ENTRY_SEGMENTS) return 'too many segments';
  for (const segment of segments) {
    if (segment.length === 0) return 'empty segment (absolute path, trailing slash or double slash)';
    if (segment.length > MAX_ENTRY_SEGMENT_BYTES) return 'segment too long';
    if (segment === '.' || segment === '..') return 'relative segment';
    if (!SEGMENT_RE.test(segment)) return 'character outside the allowlist';
    if (WINDOWS_DEVICE_RE.test(segment)) return 'reserved device name';
  }
  return null;
}

/** Returns `name` unchanged when it is a safe relative entry name, otherwise throws. */
export function assertEntryName(name: string): string {
  const problem = entryNameProblem(name);
  if (problem !== null) throw new DataPackageFormatError('entry_name_invalid', `entry name rejected: ${problem}`);
  return name;
}

/** Case-folded comparison key: two names that differ only by case collide on case-insensitive disks. */
export function entryNameFoldKey(name: string): string {
  return name.toLowerCase();
}

/** Throws on the first name that repeats another once case is folded. Names must already be valid (ASCII). */
export function assertNoDuplicateEntryNames(names: Iterable<string>): void {
  const seen = new Set<string>();
  for (const name of names) {
    const key = entryNameFoldKey(name);
    if (seen.has(key)) throw new DataPackageFormatError('entry_name_duplicate', 'two entries share a name once case is folded');
    seen.add(key);
  }
}

/**
 * Throws when one entry is a directory prefix of another (`media/index.json` and `media/index.json/x`): on
 * disk one of them cannot exist. Case-folded; names must already be valid.
 */
export function assertNoPrefixCollisions(names: readonly string[]): void {
  const all = new Set(names.map(entryNameFoldKey));
  for (const name of all) {
    for (let at = name.indexOf('/'); at !== -1; at = name.indexOf('/', at + 1)) {
      if (all.has(name.slice(0, at))) throw new DataPackageFormatError('entry_name_duplicate', 'an entry is a directory prefix of another');
    }
  }
}
