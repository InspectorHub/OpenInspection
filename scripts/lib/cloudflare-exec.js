import { spawnSync } from 'child_process';

// =============================================================================
// OpenInspection — Cloudflare Setup: exec/wrangler-invocation wrapper + loggers
// =============================================================================

export const info = (msg) => console.log(`  ✓ ${msg}`);
export const step = (msg) => { console.log(`\n▶ ${msg}`); };
export const warn = (msg) => console.warn(`  ⚠ ${msg}`);
export const die = (msg) => { console.error(`\n  ✗ ERROR: ${msg}`); process.exit(1); };

export function run(cmd, options = {}) {
    const parts = cmd.split(' ');
    const command = parts[0];
    const args = parts.slice(1);
    const maxRetries = options.ignoreRetry ? 0 : 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
        if (attempt > 0) {
            console.log(`  ⚠ Network timeout or instability detected. Retrying (${attempt}/${maxRetries})...`);
            // Brief sync sleep for 2s
            const start = Date.now();
            while (Date.now() - start < 2000) {}
        }

        const result = spawnSync(command, args, {
            encoding: 'utf8',
            shell: true,
            stdio: 'pipe',
            input: options.input,
            env: { ...process.env, CI: 'true', NON_INTERACTIVE: 'true', WRANGLER_SEND_METRICS: 'false' },
            ...options
        });

        const output = (result.stdout || '') + (result.stderr || '');

        // Success
        if (result.status === 0) {
            if (!options.silent) {
                process.stdout.write(result.stdout || '');
                process.stderr.write(result.stderr || '');
            }
            // stdoutOnly: return clean stdout for `--json` calls. wrangler prints
            // config warnings ("unsafe fields …") to stderr; merging them in
            // would corrupt the JSON for any parser.
            return options.stdoutOnly ? (result.stdout || '') : output;
        }

        // Specifically check for Cloudflare timeout / network errors
        const isTimeout = output.includes('timed out') || output.includes('timeout') || output.includes('ETIMEDOUT') || output.includes('fetch failed');

        if (isTimeout && attempt < maxRetries) {
            attempt++;
            continue;
        }

        // Final failure logic
        if (!options.ignoreError) {
            process.stdout.write(result.stdout || '');
            process.stderr.write(result.stderr || '');
            die(`Command failed after ${attempt} retries: ${cmd}\n${output}`);
        }
        return output;
    }
}

export function extractJson(output) {
    if (!output) return null;
    // `run()` merges stderr into the output and wrangler prepends ANSI-colored
    // banners (e.g. "▲ [WARNING] ... unsafe fields") whose literal "[WARNING]"
    // and color codes contain '[' — a naive indexOf('[') grabs that, not the
    // JSON array. Strip ANSI, then scan each '[' / '{' as a candidate start and
    // return the first substring that actually parses.
    const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (ch !== '[' && ch !== '{') continue;
        const close = ch === '[' ? clean.lastIndexOf(']') : clean.lastIndexOf('}');
        if (close <= i) continue;
        try {
            return JSON.parse(clean.slice(i, close + 1));
        } catch (e) { /* try the next candidate start */ }
    }
    return null;
}
