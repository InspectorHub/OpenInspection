import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { FullResult, Reporter } from '@playwright/test/reporter';
import { SHOT_ROOT } from './_harness';
import { createDocsShotsMeta, listCapturedSlugs, writeDocsShotsMeta } from './meta';

export default class DocsShotsMetaReporter implements Reporter {
    onEnd(result: FullResult): void {
        if (result.status !== 'passed') return;

        const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
        const sha = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim();
        const engineSha = dirty ? `${sha}-dirty` : sha;
        const root = path.resolve(SHOT_ROOT);
        const slugs = listCapturedSlugs(root);
        if (slugs.length === 0) return;
        const meta = createDocsShotsMeta(engineSha, new Date().toISOString(), slugs);
        writeDocsShotsMeta(root, meta);
    }
}
