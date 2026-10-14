#!/usr/bin/env node
/**
 * Native contract generator entry-point.
 *
 * Usage: npm run native:contract
 *
 * Delegates to a vitest subprocess for the same reason scripts/snapshot-openapi.mjs
 * does: server/index.ts imports `cloudflare:workers`, a runtime-only module that
 * the vitest harness stubs through a path alias. GENERATE_NATIVE_CONTRACT=true
 * activates the generator block in tests/unit/native/generate-contract.spec.ts.
 *
 * The committed artifact is contracts/native-contract.openapi.json.
 */
import { spawnSync } from 'node:child_process';

const result = spawnSync(
    'npx vitest run tests/unit/native/generate-contract.spec.ts --config vitest.api.config.ts --reporter=verbose',
    [],
    {
        stdio: 'inherit',
        env: { ...process.env, GENERATE_NATIVE_CONTRACT: 'true' },
        shell: true,
    },
);

process.exit(result.status ?? 1);
