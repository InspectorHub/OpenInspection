import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface DocsShotsMeta {
    engineSha: string;
    capturedAt: string;
    slugs: string[];
}

export function createDocsShotsMeta(engineSha: string, capturedAt: string, slugs: string[]): DocsShotsMeta {
    return { engineSha, capturedAt, slugs: [...slugs].sort() };
}

export function writeDocsShotsMeta(root: string, meta: DocsShotsMeta): void {
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'META.json'), `${JSON.stringify(meta)}\n`);
}

export function listCapturedSlugs(root: string): string[] {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
}
