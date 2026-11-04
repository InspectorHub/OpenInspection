import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Every api unit spec under tests/unit, as sorted forward-slash paths relative to `root`. */
export function listSpecs(root) {
    const out = [];
    (function walk(d) {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.spec.ts')) out.push(p.slice(root.length + 1).replaceAll(String.fromCharCode(92), '/'));
        }
    })(join(root, 'tests/unit'));
    return out.sort();
}
