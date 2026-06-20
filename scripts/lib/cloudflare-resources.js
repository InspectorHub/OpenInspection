import { run, extractJson } from './cloudflare-exec.js';

// =============================================================================
// OpenInspection — Cloudflare Setup: resource state (D1/KV/R2) discovery
// =============================================================================

export function getCloudflareState({ isLocal }) {
    if (isLocal) return { d1: [], kv: [], r2: [] };
    const state = { d1: [], kv: [], r2: [] };
    try {
        const d1Output = run('npx wrangler d1 list --json', { silent: true, ignoreError: true, stdoutOnly: true });
        const d1 = extractJson(d1Output);
        state.d1 = Array.isArray(d1) ? d1 : [];
    } catch (e) {}
    try {
        const kvOutput = run('npx wrangler kv namespace list', { silent: true, ignoreError: true, stdoutOnly: true });
        const kv = extractJson(kvOutput);
        state.kv = Array.isArray(kv) ? kv : [];
    } catch (e) {}
    try {
        const r2Output = run('npx wrangler r2 bucket list', { silent: true, ignoreError: true, stdoutOnly: true });
        const lines = r2Output.split('\n');
        state.r2 = lines.filter(l => l.startsWith('name:')).map(l => l.replace('name:', '').trim());
    } catch (e) {}
    return state;
}
