#!/usr/bin/env node
/**
 * Snapshot generator entry-point.
 *
 * Usage: npm run mcp:snapshot
 *
 * WHY A VITEST SUBPROCESS:
 * server/index.ts (and its transitive imports) reference `cloudflare:workers`,
 * a runtime-only module that does not exist in plain Node. The vitest harness
 * already stubs it via a path alias (tests/unit/stubs/cloudflare-workers.ts).
 * Rather than maintaining a second alias mechanism, we delegate to that harness
 * by spawning a vitest run with GENERATE_SNAPSHOT=true, which activates the
 * generator describe block in tests/unit/mcp/generate-snapshot.spec.ts.
 *
 * The committed artifact is server/lib/mcp/openapi-snapshot.json.
 */
import { spawnSync } from 'node:child_process';

const result = spawnSync(
    'npx vitest run tests/unit/mcp/generate-snapshot.spec.ts --config vitest.api.config.ts --reporter=verbose',
    [],
    {
        stdio: 'inherit',
        env: { ...process.env, GENERATE_SNAPSHOT: 'true' },
        shell: true,
    },
);

process.exit(result.status ?? 1);
