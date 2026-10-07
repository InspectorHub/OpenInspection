#!/usr/bin/env node
/**
 * Apply the narrow Wrangler compatibility patch after install.
 *
 * Wrangler 4.147.0 includes the upstream ProxyWorker error handling and
 * preserves serialized errors in castErrorCause, but castErrorCause2 still
 * rebuilds them as an empty Error. This patch keeps the posted message, name,
 * and stack on that second path; it does not claim that workers-sdk#15317 is
 * fully resolved upstream.
 *
 * The version and source-shape checks are intentional: when Wrangler changes,
 * installation must fail until this behavior is reviewed against the new
 * bundle. check-wrangler-patch.mjs invokes this script in read-only mode from
 * the push gate.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const expectedVersion = '4.147.0';
const version = require_('wrangler/package.json').version;

if (version !== expectedVersion) {
    console.error(`[wrangler-patch] expected wrangler ${expectedVersion}, found ${version}`);
    process.exit(1);
}

const bundlePath = require_.resolve('wrangler');
if (!existsSync(bundlePath)) {
    console.error(`[wrangler-patch] cannot find ${bundlePath}`);
    process.exit(1);
}

const name = '([\\w$]+)';
const unpatched = new RegExp(
    `function castErrorCause2\\(cause\\) \\{\\s*`
    + `if \\(cause instanceof Error\\) return cause;\\s*`
    + `const ${name} = (?:\\/\\* @__PURE__ \\*\\/ )?new Error\\(\\);\\s*`
    + `\\1\\.cause = cause;\\s*return \\1;\\s*\\}`,
);
const patched = new RegExp(
    `function castErrorCause2\\(cause\\) \\{\\s*`
    + `if \\(cause instanceof Error\\) return cause;\\s*`
    + `const ${name} = (?:\\/\\* @__PURE__ \\*\\/ )?new Error\\(\\s*`
    + `cause && typeof cause === "object" && typeof cause.message === "string" \\? cause.message : void 0\\s*\\);\\s*`
    + `if \\(cause && typeof cause === "object"\\) \\{\\s*`
    + `if \\(typeof cause.name === "string"\\) \\1\\.name = cause.name;\\s*`
    + `if \\(typeof cause.stack === "string"\\) \\1\\.stack = cause.stack;\\s*\\}\\s*`
    + `\\1\\.cause = cause;\\s*return \\1;\\s*\\}`,
);

const checkOnly = process.argv.includes('--check');
const bundle = readFileSync(bundlePath, 'utf8');
if (!bundle.includes('event.reason.startsWith("Error inside ProxyWorker")')) {
    console.error('[wrangler-patch] Wrangler no longer contains the expected upstream ProxyWorker handling');
    process.exit(1);
}

if (patched.test(bundle)) {
    console.log(`[wrangler-patch] Wrangler ${version}: compatibility behavior is present`);
    process.exit(0);
}

if (checkOnly) {
    console.error('[wrangler-patch] castErrorCause2 does not preserve serialized error details');
    process.exit(1);
}

if (!unpatched.test(bundle)) {
    console.error('[wrangler-patch] Wrangler bundle changed; inspect castErrorCause2 before updating this patch');
    process.exit(1);
}

const updated = bundle.replace(unpatched, (_match, errorName) =>
    `function castErrorCause2(cause) {\n`
    + `  if (cause instanceof Error) return cause;\n`
    + `  const ${errorName} = /* @__PURE__ */ new Error(\n`
    + `    cause && typeof cause === "object" && typeof cause.message === "string" ? cause.message : void 0\n`
    + `  );\n`
    + `  if (cause && typeof cause === "object") {\n`
    + `    if (typeof cause.name === "string") ${errorName}.name = cause.name;\n`
    + `    if (typeof cause.stack === "string") ${errorName}.stack = cause.stack;\n`
    + `  }\n`
    + `  ${errorName}.cause = cause;\n`
    + `  return ${errorName};\n`
    + `}`,
);

if (updated === bundle || !patched.test(updated)) {
    console.error('[wrangler-patch] failed to apply or verify the castErrorCause2 patch');
    process.exit(1);
}

writeFileSync(bundlePath, updated);
console.log(`[wrangler-patch] applied compatibility patch to Wrangler ${version}`);
