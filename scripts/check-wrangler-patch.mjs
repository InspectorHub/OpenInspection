#!/usr/bin/env node
// Keep the push gate read-only; postinstall owns applying the bundle patch.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

execFileSync(
    process.execPath,
    [fileURLToPath(new URL('./patch-wrangler.mjs', import.meta.url)), '--check'],
    { stdio: 'inherit' },
);
