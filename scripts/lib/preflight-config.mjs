/**
 * Config-file half of the self-host preflight: a JSONC reader and the checks that
 * only need the wrangler config (bindings, cron wiring, Turnstile site key).
 *
 * Pure functions over a parsed config; no network, no wrangler, no secrets.
 */

/** Parse wrangler.jsonc: drop comments and trailing commas, string-aware. */
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inStr) {
      out += ch;
      if (ch === '\\') { out += next ?? ''; i += 2; continue; }
      if (ch === '"') inStr = false;
      i++;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; i++; continue; }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    out += ch;
    i++;
  }
  // Trailing commas, again string-aware.
  let res = '';
  inStr = false;
  for (let j = 0; j < out.length; j++) {
    const ch = out[j];
    if (inStr) {
      res += ch;
      if (ch === '\\') { res += out[j + 1] ?? ''; j++; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; res += ch; continue; }
    if (ch === ',') {
      let k = j + 1;
      while (k < out.length && /\s/.test(out[k])) k++;
      if (out[k] === '}' || out[k] === ']') continue;
    }
    res += ch;
  }
  try {
    return JSON.parse(res);
  } catch (e) {
    // Never forward the parser's message: it embeds a snippet of the text.
    const m = /position (\d+)/.exec(String(e?.message));
    const err = new Error('invalid JSONC');
    if (m) {
      const before = res.slice(0, Number(m[1]));
      err.line = before.split('\n').length;
      err.column = before.length - before.lastIndexOf('\n');
    }
    throw err;
  }
}

const isPlaceholderId = (id) => typeof id !== 'string' || id === '' || /^0+1?$/.test(id.replace(/-/g, ''));
const arr = (v) => (Array.isArray(v) ? v : []);

/** Binding name -> how to find it in the config and whether the app can run without it. */
const BINDINGS = [
  { name: 'DB', required: true, find: (c) => arr(c.d1_databases).find((b) => b.binding === 'DB'), id: (b) => b.database_id, what: 'D1 database', fix: 'Run `npm run setup:cloudflare` (or the Deploy to Cloudflare button) so a real database id is written to wrangler.local.jsonc.' },
  { name: 'PHOTOS', required: true, find: (c) => arr(c.r2_buckets).find((b) => b.binding === 'PHOTOS'), what: 'R2 bucket', fix: 'Declare an r2_buckets entry with binding PHOTOS.' },
  { name: 'TENANT_CACHE', required: true, find: (c) => arr(c.kv_namespaces).find((b) => b.binding === 'TENANT_CACHE'), id: (b) => b.id, what: 'KV namespace', fix: 'Run `npm run setup:cloudflare` to create the namespace and write its id.' },
  { name: 'CRON_QUEUE', required: true, find: (c) => arr(c.queues?.producers).find((b) => b.binding === 'CRON_QUEUE'), what: 'queue producer', fix: 'Declare the CRON_QUEUE producer and create the queue (see docs/operate/deploy.md).' },
  { name: 'OAUTH_KV', required: false, find: (c) => arr(c.kv_namespaces).find((b) => b.binding === 'OAUTH_KV'), id: (b) => b.id, what: 'KV namespace', fix: 'Create a KV namespace and replace the OAUTH_KV placeholder id in wrangler.local.jsonc (needed for MCP and native app sign-in).' },
  { name: 'WORD_EXPORT_QUEUE', required: false, find: (c) => arr(c.queues?.producers).find((b) => b.binding === 'WORD_EXPORT_QUEUE'), what: 'queue producer', fix: 'Declare the WORD_EXPORT_QUEUE producer and create the queue (needed for .docx export).' },
  { name: 'BROWSER', required: false, find: (c) => (c.browser?.binding === 'BROWSER' ? c.browser : undefined), what: 'browser binding', fix: 'Declare `"browser": { "binding": "BROWSER" }` (needed for PDF rendering).' },
  { name: 'SIGN_COMPLETION_WORKFLOW', required: false, find: (c) => arr(c.workflows).find((b) => b.binding === 'SIGN_COMPLETION_WORKFLOW'), what: 'workflow', fix: 'Declare the SIGN_COMPLETION_WORKFLOW workflow (needed to finish e-signatures).' },
  { name: 'INSPECTION_DOC', required: false, find: (c) => arr(c.durable_objects?.bindings).find((b) => b.name === 'INSPECTION_DOC'), what: 'Durable Object', fix: 'Declare the INSPECTION_DOC Durable Object (needed for collaborative editing).' },
];

export const BINDING_IDS = BINDINGS.map((b) => `binding-${b.name}`);

const out = (status, message, fix) => ({ status, message, ...(fix ? { fix } : {}) });

export function bindingCheck(def) {
  return {
    id: `binding-${def.name}`,
    needs: 'config',
    run: (ctx) => {
      const b = def.find(ctx.cfg);
      if (!b) return out(def.required ? 'fail' : 'attention', `${def.name} (${def.what}) is not declared in the config`, def.fix);
      if (def.id && isPlaceholderId(def.id(b))) {
        return out(def.required ? 'fail' : 'attention', `${def.name} still has a placeholder id in the config`, def.fix);
      }
      return out('pass', `${def.name} (${def.what}) is declared`);
    },
  };
}

export const bindingChecks = () => BINDINGS.map(bindingCheck);

export const cronCheck = {
  id: 'cron',
  needs: 'config',
  run: ({ cfg }) => {
    const crons = arr(cfg.triggers?.crons);
    if (!crons.includes('*/5 * * * *')) {
      return out('fail', 'no `*/5 * * * *` cron trigger is declared, so background jobs never start', 'Add the cron triggers from the committed wrangler.jsonc.');
    }
    const producer = arr(cfg.queues?.producers).find((p) => p.binding === 'CRON_QUEUE');
    if (!producer) return out('fail', 'CRON_QUEUE has no producer, so every tick logs "CRON_QUEUE is not bound" and no job runs', 'Declare the CRON_QUEUE producer.');
    const consumed = arr(cfg.queues?.consumers).some((c) => c.queue === producer.queue);
    if (!consumed) return out('fail', 'the CRON_QUEUE queue has no consumer in the config, so jobs would be queued and never run', 'Declare a consumer for the same queue.');
    return out('pass', 'the cron trigger and the CRON_QUEUE producer and consumer are declared (whether a tick has actually fired is not checked)');
  },
};

export const TEST_SITE_KEY = '1x00000000000000000000AA';
