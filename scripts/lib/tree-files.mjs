/**
 * The tracked-file view shared by the whole-tree checks in check-tree-hygiene.mjs.
 *
 * `git ls-files` is listed once and each file is read at most once, however many
 * checks ask for it: raw-NUL and line-ending checks both want the bytes of every
 * tracked text file, and reading ~5,700 files twice was most of what a second
 * walk cost.
 *
 * `read` rethrows the original error on a repeat read, so a tracked path the
 * working tree does not hold is counted as unreadable by EVERY check that asks,
 * not silently folded into "clean" by the second one.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function treeContext(args = []) {
    let list = null;
    const cache = new Map();
    return {
        args,
        /** @returns {string[]} every tracked path, forward slashes */
        tracked() {
            if (list === null) {
                list = execSync('git ls-files -z', { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
                    .toString('utf8')
                    .split('\0')
                    .filter((p) => p !== '');
            }
            return list;
        },
        /** @returns {Buffer} */
        read(path) {
            if (!cache.has(path)) {
                try {
                    cache.set(path, readFileSync(path));
                } catch (err) {
                    cache.set(path, err);
                }
            }
            const hit = cache.get(path);
            if (hit instanceof Error) throw hit;
            return hit;
        },
        /** Drop a cached read (used after a check rewrites the file). */
        forget(path) {
            cache.delete(path);
        },
    };
}
