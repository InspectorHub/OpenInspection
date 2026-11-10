import { DataPackageFormatError } from './errors';

/** A JSON value as `JSON.parse` can produce it. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Container nesting allowed. Deeper than any real row (a template schema nests a handful of levels); bounds downstream recursion. */
export const MAX_JSON_DEPTH = 64;

/** A lone (unpaired) UTF-16 surrogate: `JSON.parse` accepts an escaped one, but it cannot be stored or round-tripped as UTF-8. */
const LONE_SURROGATE_RE = new RegExp('[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]');
const NUL = String.fromCharCode(0);

function unsafe(why: string): never {
  throw new DataPackageFormatError('json_unsafe', why);
}

function checkString(text: string): void {
  if (text.length === 0) return;
  if (text.includes(NUL)) unsafe('NUL character');
  if (LONE_SURROGATE_RE.test(text)) unsafe('unpaired surrogate');
}

function checkScalar(value: string | number | boolean | null): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) unsafe('non-finite number');
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) unsafe('integer outside the safe range');
  } else if (typeof value === 'string') {
    checkString(value);
  }
}

interface Frame {
  readonly node: JsonValue[] | JsonObject;
  /** Keys of an object node (`null` for an array). */
  readonly keys: string[] | null;
  next: number;
}

/**
 * Walk a parsed value iteratively and refuse what `JSON.parse` accepts but a faithful restore cannot
 * honour: an own `__proto__` key at any depth, non-finite numbers (`1e999` parses to Infinity), integers
 * beyond 2^53 (silently rounded), strings or keys with NUL or an unpaired surrogate, and nesting deeper
 * than `maxDepth`.
 *
 * Memory is O(depth), not O(elements): the stack holds one cursor per open container, never one entry per
 * element, and scalars are checked inline. (A 4 MiB line of 2 million numbers used to push 2 million stack
 * objects and exhaust a 128 MB isolate.) Only `__proto__` is refused as a key at depth: `constructor` and
 * `prototype` are ordinary data keys in a parsed object and cannot reach `Object.prototype` (only the
 * `__proto__` setter can); top-level column names get the stricter pattern in `ndjson.ts`.
 */
export function assertSafeJson(root: JsonValue, maxDepth: number = MAX_JSON_DEPTH): void {
  if (typeof root !== 'object' || root === null) {
    checkScalar(root);
    return;
  }
  const stack: Frame[] = [];
  const open = (node: JsonValue[] | JsonObject): void => {
    if (stack.length >= maxDepth) unsafe('nesting too deep');
    stack.push({ node, keys: Array.isArray(node) ? null : Object.keys(node), next: 0 });
  };
  open(root);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (!frame) break;
    let child: JsonValue | undefined;
    if (frame.keys === null) {
      const list = frame.node as JsonValue[];
      if (frame.next >= list.length) {
        stack.pop();
        continue;
      }
      child = list[frame.next++];
    } else {
      if (frame.next >= frame.keys.length) {
        stack.pop();
        continue;
      }
      const key = frame.keys[frame.next++] as string;
      if (key === '__proto__') unsafe('forbidden key');
      checkString(key);
      child = (frame.node as JsonObject)[key];
    }
    if (child === undefined) continue;
    if (typeof child === 'object' && child !== null) open(child);
    else checkScalar(child);
  }
}

/** `JSON.parse` + `assertSafeJson`. Malformed text becomes a typed error, never a bare SyntaxError. */
export function parseJsonStrict(text: string, maxDepth: number = MAX_JSON_DEPTH): JsonValue {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text) as JsonValue;
  } catch {
    throw new DataPackageFormatError('json_invalid', 'malformed JSON');
  }
  assertSafeJson(parsed, maxDepth);
  return parsed;
}
