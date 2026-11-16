import { entryNameProblem } from './entry-name';
import { DataPackageFormatError } from './errors';
import { hasUnpairedSurrogate } from './safe-json';
import { Sha256Js } from './sha256-js';
import { DATA_PACKAGE_MEDIA_INDEX_ENTRY } from './volume';

/**
 * Maps an R2 object key (relative to the tenant prefix) to the entry name it gets inside a media volume.
 *
 * The package entry-name rules are strict (ASCII allowlist, case-folded uniqueness, no directory/file clashes),
 * and real keys are not always inside them. The importer never trusts an entry name for anything: it restores
 * each object from the media index row (`key`, `entry`, `sha256`, ...), so an entry name only has to be a safe,
 * unique name for the zip.
 *
 * Rules, all pure and deterministic:
 *  - A key passes through unchanged (`media/<key>`) when it is already a valid entry name, contains no upper-case
 *    letter (so two pass-through keys can never collide once case is folded) and its FIRST path segment is neither
 *    `_mapped` (the renamed names' directory) nor `index.ndjson` (the media index file).
 *  - Every other key is renamed to `media/_mapped/<first 32 hex of sha256(key)>/<sanitized last segment>`. The
 *    hash directory makes renamed names unique (128-bit prefix), and `_mapped/` is reserved so a renamed name can
 *    never equal a pass-through name.
 *  - `forceRename` renames a key that would pass through. The exporter uses it for the one thing a stateless
 *    mapping cannot see: an R2 key that is a directory prefix of another (`x` and `x/y`), which cannot both be
 *    zip entries. It detects the clash while listing and force-renames one of the two.
 */
const MAX_KEY_BYTES = 1024;
const MAPPED_DIR = '_mapped';
const MAPPED_PREFIX = `${MAPPED_DIR}/`;
const INDEX_NAME = DATA_PACKAGE_MEDIA_INDEX_ENTRY.slice('media/'.length);
/** True when the key holds a C0 control character or DEL. */
function hasControlChar(key: string): boolean {
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}
const LEAF_UNSAFE_RE = /[^A-Za-z0-9._@+=,~()-]/g;
const encoder = new TextEncoder();

/** A short reason the key is unusable (not a safe relative object key), or `null`. */
export function keyProblem(key: string): string | null {
  if (key.length === 0) return 'empty';
  if (key.length > MAX_KEY_BYTES || (key.length * 3 > MAX_KEY_BYTES && encoder.encode(key).byteLength > MAX_KEY_BYTES)) return 'too long';
  if (key.startsWith('/')) return 'absolute';
  if (key.includes('\\')) return 'backslash';
  if (hasControlChar(key)) return 'control character';
  if (hasUnpairedSurrogate(key)) return 'unpaired surrogate';
  for (const segment of key.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') return 'empty or relative segment';
  }
  return null;
}

function sha256Hex32(text: string): string {
  const hasher = new Sha256Js();
  hasher.update(encoder.encode(text));
  return hasher.digestHex().slice(0, 32);
}

function sanitizeLeaf(key: string): string {
  const last = key.slice(key.lastIndexOf('/') + 1);
  let leaf = last.replace(LEAF_UNSAFE_RE, '_').slice(0, 100).replace(/\.+$/, ''); // cut first, then strip trailing dots (a cut can end on one)
  if (leaf === '') leaf = 'object';
  if (entryNameProblem(`media/${MAPPED_PREFIX}x/${leaf}`) !== null) leaf = `_${leaf}`;
  return entryNameProblem(`media/${MAPPED_PREFIX}x/${leaf}`) === null ? leaf : 'object';
}

interface MappedEntry {
  readonly entry: string;
  readonly renamed: boolean;
}

export function mapKeyToEntryName(key: string, options: { forceRename?: boolean } = {}): MappedEntry {
  const problem = keyProblem(key);
  if (problem !== null) throw new DataPackageFormatError('entry_name_invalid', `object key rejected: ${problem}`);
  const plain = `media/${key}`;
  const firstSegment = key.slice(0, key.indexOf('/') === -1 ? key.length : key.indexOf('/'));
  const passes =
    options.forceRename !== true &&
    key === key.toLowerCase() &&
    firstSegment !== MAPPED_DIR && // a key `_mapped` would be a file where renamed names need a directory
    firstSegment !== INDEX_NAME && // `index.ndjson` or anything below it would clash with the media index file
    entryNameProblem(plain) === null;
  if (passes) return { entry: plain, renamed: false };
  return { entry: `media/${MAPPED_PREFIX}${sha256Hex32(key)}/${sanitizeLeaf(key)}`, renamed: true };
}
