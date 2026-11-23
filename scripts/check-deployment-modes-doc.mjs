#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(ROOT, 'node_modules/tsx/dist/cli.mjs');
const result = spawnSync(process.execPath, [cli, 'scripts/gen-deployment-modes-doc.ts', '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) {
    console.error(`[modes-doc] could not start generator: ${result.error.message}`);
    process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
