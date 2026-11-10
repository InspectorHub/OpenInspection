import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * scripts/preflight-self-host.mjs checks a freshly deployed instance before any
 * data goes in. Everything here runs against a local fake HTTP server and a fake
 * wrangler runner; nothing touches a real instance or Cloudflare.
 */
interface Result { id: string; status: 'pass' | 'attention' | 'fail'; message: string; fix?: string }
interface Report {
    checks: Result[];
    counts: { pass: number; attention: number; fail: number; total: number };
    questions: string[];
    exitCode: number;
}
type RunResult = { status: number; stdout: string; stderr: string; code?: string };
interface Invocation { cmd?: string; args?: string[]; shell?: boolean; error?: string }
interface Mod {
    makeRunner(configPath: string, env: { platform: string; wranglerBin: string | null; execPath: string }, spawn: (cmd: string, args: string[], o: Record<string, unknown>) => { status: number | null; stdout: string; stderr: string; error?: { code?: string } }): (args: string[], o?: { cwd?: string }) => Promise<RunResult>;
    buildInvocation(args: string[], configPath: string, env: { platform: string; wranglerBin: string | null; execPath: string }): Invocation;
    runPreflight(o: Record<string, unknown>): Promise<Report>;
    parseArgs(argv: string[]): Record<string, unknown>;
    main(argv: string[], io: { stdout: (s: string) => void; stderr: (s: string) => void }, deps?: Record<string, unknown>): Promise<number>;
    parseJsonc(text: string): Record<string, unknown>;
}

const SCRIPT = pathToFileURL(join(process.cwd(), 'scripts', 'preflight-self-host.mjs')).href;
const win = (s: string): string => s.replace(/@/g, String.fromCharCode(92));
const SECRET = 'SUPERSECRETVALUE0123456789abcdefghijklmnop';
const PEM = '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg\n-----END PRIVATE KEY-----';

let mod: Mod;
let server: Server;
let base: string;
let statusBody: unknown = { status: 'ok', app: 'openinspection-core', version: '1.2.3' };
let statusCode = 200;
let dir: string;

const GOOD_CONFIG = `{
  // comments and trailing commas are allowed in wrangler.jsonc
  "name": "oi",
  "triggers": { "crons": ["*/5 * * * *", "0 3 * * *",], },
  "vars": { "JWT_CURRENT_KID": "v1", "TURNSTILE_SITE_KEY": "0x4AAAAAAAreal" },
  "d1_databases": [{ "binding": "DB", "database_name": "d", "database_id": "11111111-2222-3333-4444-555555555555" }],
  "kv_namespaces": [
    { "binding": "TENANT_CACHE", "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    { "binding": "OAUTH_KV", "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
  ],
  "r2_buckets": [{ "binding": "PHOTOS", "bucket_name": "my-photos" }],
  "queues": {
    "producers": [{ "queue": "oi-cron", "binding": "CRON_QUEUE" }, { "queue": "oi-word", "binding": "WORD_EXPORT_QUEUE" }],
    "consumers": [{ "queue": "oi-cron" }, { "queue": "oi-word" }]
  },
  "browser": { "binding": "BROWSER" },
  "workflows": [{ "binding": "SIGN_COMPLETION_WORKFLOW", "name": "w", "class_name": "C" }],
  "durable_objects": { "bindings": [{ "name": "INSPECTION_DOC", "class_name": "X" }] }
}`;

const ALL_SECRETS = ['JWT_SECRET', 'JWT_PRIVATE_KEY_V1', 'JWT_PUBLIC_KEY_V1', 'TURNSTILE_SECRET_KEY', 'RESEND_API_KEY', 'SENDER_EMAIL'];

function cfgFile(text: string): string {
    const p = join(dir, `cfg-${Math.random().toString(36).slice(2)}.jsonc`);
    writeFileSync(p, text);
    return p;
}

interface FakeOpts { secrets?: string[]; putStatus?: number; deleteStatus?: number; leak?: boolean; putTimesOutButLands?: boolean; unsafeArg?: boolean }
function fakeRunner(o: FakeOpts = {}) {
    const calls: string[][] = [];
    const objects = new Set<string>();
    const cwds: (string | undefined)[] = [];
    const run = async (args: string[], opts?: { cwd?: string }): Promise<RunResult> => {
        calls.push(args);
        cwds.push(opts?.cwd);
        if (o.unsafeArg && args[0] === 'r2') return { status: 1, stdout: '', stderr: '', code: 'UNSAFE_ARG' };
        const k = args.join(' ');
        if (k.startsWith('secret list')) {
            const names = o.secrets ?? ALL_SECRETS;
            return { status: 0, stdout: `warning noise\n${JSON.stringify(names.map((name) => ({ name, type: 'secret_text', value: SECRET })))}\n`, stderr: '' };
        }
        if (k.startsWith('r2 object put')) {
            const target = args[3]!;
            if (o.putTimesOutButLands) { objects.add(target); return { status: 1, stdout: '', stderr: '', code: 'ETIMEDOUT' }; }
            if (o.putStatus) return { status: o.putStatus, stdout: '', stderr: o.leak ? `denied ${PEM} token ${SECRET}` : 'denied' };
            objects.add(target);
            return { status: 0, stdout: '', stderr: '' };
        }
        if (k.startsWith('r2 object delete')) {
            if (o.deleteStatus) return { status: o.deleteStatus, stdout: '', stderr: 'nope' };
            objects.delete(args[3]!);
            return { status: 0, stdout: '', stderr: '' };
        }
        return { status: 1, stdout: '', stderr: 'unknown' };
    };
    return { run, calls, objects, cwds };
}

beforeAll(async () => {
    mod = (await import(/* @vite-ignore */ SCRIPT)) as Mod;
    dir = mkdtempSync(join(tmpdir(), 'preflight-spec-'));
    server = createServer((req, res) => {
        if (req.url === '/status') {
            res.writeHead(statusCode, { 'content-type': 'application/json' });
            res.end(typeof statusBody === 'string' ? statusBody : JSON.stringify(statusBody));
        } else {
            res.writeHead(404).end();
        }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
});

const by = (r: Report, id: string): Result => {
    const c = r.checks.find((x) => x.id === id);
    if (!c) throw new Error(`no check ${id}; have ${r.checks.map((x) => x.id).join(',')}`);
    return c;
};

async function run(over: Record<string, unknown> = {}, fake: FakeOpts = {}) {
    statusBody = { status: 'ok', app: 'openinspection-core', version: '1.2.3' };
    statusCode = 200;
    const f = fakeRunner(fake);
    const report = await mod.runPreflight({ url: base, configPath: cfgFile(GOOD_CONFIG), run: f.run, tmpDir: dir, ...over });
    return { report, f };
}

describe('preflight: a healthy instance', () => {
    it('passes every check that can be decided and exits 0', async () => {
        const { report } = await run();
        const bad = report.checks.filter((c) => c.status === 'fail');
        expect(bad).toEqual([]);
        expect(report.exitCode).toBe(0);
        expect(report.counts.total).toBe(report.checks.length);
        expect(report.counts.pass + report.counts.attention + report.counts.fail).toBe(report.counts.total);
        expect(report.counts.total).toBeGreaterThanOrEqual(10);
        expect(by(report, 'status').message).toContain('1.2.3');
        expect(by(report, 'photos-write').status).toBe('pass');
        expect(by(report, 'jwt-keyring').status).toBe('pass');
    });

    it('asks, rather than decides, the questions the app cannot see', async () => {
        const { report } = await run();
        expect(report.questions.join(' ')).toMatch(/paid/i);
        expect(report.checks.map((c) => c.id)).not.toContain('plan');
    });
});

describe('preflight: /status', () => {
    it('fails when the instance answers 500', async () => {
        statusCode = 200;
        const f = fakeRunner();
        const cfg = cfgFile(GOOD_CONFIG);
        statusCode = 500;
        const r = await mod.runPreflight({ url: base, configPath: cfg, run: f.run, tmpDir: dir });
        expect(by(r, 'status').status).toBe('fail');
        expect(r.exitCode).toBe(1);
    });


    it('fails on a body that is not an engine health answer', async () => {
        statusBody = { status: 'ok' };
        const f = fakeRunner();
        const r = await mod.runPreflight({ url: base, configPath: cfgFile(GOOD_CONFIG), run: f.run, tmpDir: dir });
        expect(by(r, 'status').status).toBe('fail');
    });

    it('fails when nothing listens', async () => {
        const f = fakeRunner();
        const r = await mod.runPreflight({ url: 'http://127.0.0.1:1', configPath: cfgFile(GOOD_CONFIG), run: f.run, tmpDir: dir });
        expect(by(r, 'status').status).toBe('fail');
        expect(r.exitCode).toBe(1);
    });

    it('fails when the version is below --min-version', async () => {
        const { report } = await run({ minVersion: '2.0.0' });
        expect(by(report, 'status').status).toBe('fail');
    });
});

describe('preflight: base URL', () => {
    it('asks for attention on a workers.dev host and on plain http', async () => {
        const { report } = await run({ only: ['base-url'], url: base });
        expect(by(report, 'base-url').status).toBe('attention');
        const wd = await run({ only: ['base-url'], url: 'https://oi.example.workers.dev' });
        expect(by(wd.report, 'base-url').status).toBe('attention');
        expect(by(wd.report, 'base-url').message).toMatch(/workers\.dev/);
    });
    it('passes on a custom https host', async () => {
        const { report } = await run({ only: ['base-url'], url: 'https://inspect.example.com' });
        expect(by(report, 'base-url').status).toBe('pass');
    });
});

describe('preflight: bindings from the config file', () => {
    it('fails when a required binding is missing', async () => {
        const noPhotos = GOOD_CONFIG.replace('"PHOTOS"', '"NOT_PHOTOS"');
        const { report } = await run({ configPath: cfgFile(noPhotos) });
        expect(by(report, 'binding-PHOTOS').status).toBe('fail');
        expect(report.exitCode).toBe(1);
    });
    it('fails on a placeholder database id and flags a placeholder OAUTH_KV id', async () => {
        const cfg = GOOD_CONFIG
            .replace('11111111-2222-3333-4444-555555555555', '00000000-0000-0000-0000-000000000000')
            .replace('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '00000000000000000000000000000001');
        const { report } = await run({ configPath: cfgFile(cfg) });
        expect(by(report, 'binding-DB').status).toBe('fail');
        expect(by(report, 'binding-OAUTH_KV').status).toBe('attention');
    });
    it('fails when the cron queue has no consumer or the */5 trigger is missing', async () => {
        const noConsumer = GOOD_CONFIG.replace('{ "queue": "oi-cron" },', '');
        const a = await run({ configPath: cfgFile(noConsumer) });
        expect(by(a.report, 'cron').status).toBe('fail');
        const noTrigger = GOOD_CONFIG.replace('"*/5 * * * *", ', '');
        const b = await run({ configPath: cfgFile(noTrigger) });
        expect(by(b.report, 'cron').status).toBe('fail');
    });
    it('fails when the config file cannot be parsed', async () => {
        const { report } = await run({ configPath: cfgFile('{ nope') });
        expect(by(report, 'config').status).toBe('fail');
        expect(report.exitCode).toBe(1);
    });
});

describe('preflight: JWT keyring', () => {
    it('fails when the public half for the current kid is missing', async () => {
        const { report } = await run({}, { secrets: ['JWT_SECRET', 'JWT_PRIVATE_KEY_V1'] });
        expect(by(report, 'jwt-keyring').status).toBe('fail');
        expect(by(report, 'jwt-keyring').message).toContain('JWT_PUBLIC_KEY_V1');
        expect(report.exitCode).toBe(1);
    });
    it('fails when the current kid points at a pair that does not exist', async () => {
        const cfg = GOOD_CONFIG.replace('"JWT_CURRENT_KID": "v1"', '"JWT_CURRENT_KID": "v2"');
        const { report } = await run({ configPath: cfgFile(cfg) });
        expect(by(report, 'jwt-keyring').status).toBe('fail');
    });
    it('fails when JWT_SECRET is missing', async () => {
        const { report } = await run({}, { secrets: ['JWT_PRIVATE_KEY_V1', 'JWT_PUBLIC_KEY_V1'] });
        expect(by(report, 'jwt-keyring').status).toBe('fail');
    });
});

describe('preflight: PHOTOS write probe', () => {
    it('puts and deletes one object and leaves nothing behind', async () => {
        const { report, f } = await run();
        expect(by(report, 'photos-write').status).toBe('pass');
        const put = f.calls.find((c) => c.slice(0, 3).join(' ') === 'r2 object put');
        const del = f.calls.find((c) => c.slice(0, 3).join(' ') === 'r2 object delete');
        expect(put?.[3]).toMatch(/^my-photos\/preflight\//);
        expect(del?.[3]).toBe(put?.[3]);
        expect(f.objects.size).toBe(0);
        const putIndex = f.calls.indexOf(put as string[]);
        expect(put?.[put.indexOf('--file') + 1]).toBe('probe.txt');
        const cwd = f.cwds[putIndex];
        expect(cwd).toBeTruthy();
        expect(existsSync(join(cwd as string, 'probe.txt'))).toBe(false);
        expect(existsSync(cwd as string)).toBe(false);
    });
    it('fails when the write is refused', async () => {
        const { report } = await run({}, { putStatus: 1 });
        expect(by(report, 'photos-write').status).toBe('fail');
        expect(report.exitCode).toBe(1);
    });
    it('fails and names the leftover key when the cleanup delete fails', async () => {
        const { report } = await run({}, { deleteStatus: 1 });
        const c = by(report, 'photos-write');
        expect(c.status).toBe('fail');
        expect(c.message).toMatch(/preflight\//);
    });
});

describe('preflight: attention checks', () => {
    it('asks for attention on test Turnstile keys and a missing email provider', async () => {
        const cfg = GOOD_CONFIG.replace('0x4AAAAAAAreal', '1x00000000000000000000AA');
        const { report } = await run({ configPath: cfgFile(cfg) }, { secrets: ['JWT_SECRET', 'JWT_PRIVATE_KEY_V1', 'JWT_PUBLIC_KEY_V1'] });
        expect(by(report, 'turnstile').status).toBe('attention');
        expect(by(report, 'email').status).toBe('attention');
        expect(report.exitCode).toBe(0);
    });
    it('asks for attention when a real secret key is paired with the test site key', async () => {
        const cfg = GOOD_CONFIG.replace('0x4AAAAAAAreal', '1x00000000000000000000AA');
        const { report } = await run({ configPath: cfgFile(cfg) });
        expect(by(report, 'turnstile').status).toBe('attention');
        expect(by(report, 'turnstile').message).toMatch(/test site key/i);
    });
});

describe('preflight: skipped wrangler checks are not passes', () => {
    it('reports them as attention and never calls the runner', async () => {
        const { report, f } = await run({ skipWrangler: true });
        expect(f.calls).toEqual([]);
        expect(by(report, 'photos-write').status).toBe('attention');
        expect(by(report, 'jwt-keyring').status).toBe('attention');
    });
});

describe('preflight: fail closed', () => {
    it('treats a run with zero checks as a failure, not a pass', async () => {
        const f = fakeRunner();
        const r = await mod.runPreflight({ url: base, configPath: cfgFile(GOOD_CONFIG), run: f.run, tmpDir: dir, checks: [] });
        expect(r.counts.total).toBe(0);
        expect(r.exitCode).toBe(1);
    });
    it('treats a check that throws as a failed check', async () => {
        const f = fakeRunner();
        const r = await mod.runPreflight({
            url: base, configPath: cfgFile(GOOD_CONFIG), run: f.run, tmpDir: dir,
            checks: [{ id: 'boom', run: async () => { throw new Error('kaboom'); } }],
        });
        expect(by(r, 'boom').status).toBe('fail');
        expect(r.exitCode).toBe(1);
    });
    it('a single failure among passes exits 1', async () => {
        const { report } = await run({}, { putStatus: 1 });
        expect(report.counts.fail).toBe(1);
        expect(report.counts.pass).toBeGreaterThan(5);
        expect(report.exitCode).toBe(1);
    });
});

describe('preflight: secrets never reach the output', () => {
    it('prints names only: neither text nor json mode contains a value or PEM', async () => {
        const f = fakeRunner({ putStatus: 1, leak: true });
        const out: string[] = [];
        const err: string[] = [];
        statusCode = 200;
        statusBody = { status: 'ok', app: 'openinspection-core', version: '1.2.3' };
        for (const flag of [[], ['--json']]) {
            const code = await mod.main(
                ['--url', base, '--config', cfgFile(GOOD_CONFIG), ...flag],
                { stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
                { run: f.run, tmpDir: dir },
            );
            expect(code).toBe(1);
        }
        const all = out.join('\n') + err.join('\n');
        expect(all).not.toContain(SECRET);
        expect(all).not.toContain('BEGIN PRIVATE KEY');
        expect(all).not.toContain('MIGHAgEAMBMGByqGSM49');
    });
    it('does not echo config values such as database ids', async () => {
        const out: string[] = [];
        await mod.main(['--url', base, '--config', cfgFile(GOOD_CONFIG)], { stdout: (s) => out.push(s), stderr: () => undefined }, { run: fakeRunner().run, tmpDir: dir });
        expect(out.join('\n')).not.toContain('11111111-2222-3333-4444-555555555555');
    });
});

describe('preflight: command line', () => {
    it('exits 2 on bad usage and prints nothing to stdout', async () => {
        for (const argv of [[], ['--url'], ['--url', 'not a url'], ['--url', base, '--bogus'], ['--url', base, '--only', 'nope']]) {
            const out: string[] = [];
            const err: string[] = [];
            const code = await mod.main(argv, { stdout: (s) => out.push(s), stderr: (s) => err.push(s) }, { run: fakeRunner().run });
            expect(code).toBe(2);
            expect(out).toEqual([]);
            expect(err.join('')).toMatch(/usage/i);
        }
    });
    it('--json prints one parseable document with both counts and the exit code', async () => {
        const out: string[] = [];
        const code = await mod.main(['--url', base, '--config', cfgFile(GOOD_CONFIG), '--json'], { stdout: (s) => out.push(s), stderr: () => undefined }, { run: fakeRunner().run, tmpDir: dir });
        const doc = JSON.parse(out.join('')) as Report;
        expect(code).toBe(0);
        expect(doc.exitCode).toBe(0);
        expect(doc.counts.total).toBe(doc.checks.length);
        expect(Array.isArray(doc.questions)).toBe(true);
    });
    it('text mode prints passed, needs-attention and failed counts together', async () => {
        const out: string[] = [];
        await mod.main(['--url', base, '--config', cfgFile(GOOD_CONFIG)], { stdout: (s) => out.push(s), stderr: () => undefined }, { run: fakeRunner().run, tmpDir: dir });
        expect(out.join('\n')).toMatch(/\d+ passed, \d+ need attention, \d+ failed/);
    });
    it('--only runs just the named checks', async () => {
        const f = fakeRunner();
        const r = await mod.runPreflight({ url: base, configPath: cfgFile(GOOD_CONFIG), run: f.run, tmpDir: dir, only: ['status'] });
        expect(r.checks.map((c) => c.id)).toEqual(['status']);
        expect(f.calls).toEqual([]);
    });
});

describe('parseJsonc', () => {
    it('keeps comment-like text inside strings and drops real comments and trailing commas', () => {
        const v = mod.parseJsonc('{ /* c */ "u": "https://x.test//a", // tail\n "a": [1,2,], }');
        expect(v).toEqual({ u: 'https://x.test//a', a: [1, 2] });
    });
});

describe('preflight: nothing unsafe reaches a shell', () => {
    const r2Calls = (calls: string[][]) => calls.filter((c) => c[0] === 'r2');
    it.each(['x&calc', 'a|b', 'a b', '-abc', 'ab', 'A_B_C', 'abc"def'])('never runs wrangler with the bucket name %s', async (bad) => {
        const cfg = GOOD_CONFIG.replace('my-photos', bad.replace(/"/g, '\\"'));
        const { report, f } = await run({ configPath: cfgFile(cfg) });
        expect(r2Calls(f.calls)).toEqual([]);
        const c = by(report, 'photos-write');
        expect(c.status).toBe('fail');
        expect(c.message).not.toContain(bad);
        expect(report.exitCode).toBe(1);
    });
    it.each(['a.jsonc&whoami', 'has space.jsonc', 'semi;colon.jsonc'])('never reaches the runner with the config path %s', async (name) => {
        const p = join(dir, name);
        writeFileSync(p, GOOD_CONFIG);
        const { report, f } = await run({ configPath: p });
        expect(f.calls).toEqual([]);
        expect(by(report, 'config').status).toBe('fail');
        expect(by(report, 'config').message).not.toContain(name);
        expect(report.exitCode).toBe(1);
    });
    it('without a shell, a path with a space is passed as one argument', () => {
        const inv = mod.buildInvocation(['r2', 'object', 'put', 'b/k', '--file', win('C:@Users@Jo Smith@t.txt')], 'wrangler.jsonc', { platform: 'win32', wranglerBin: win('C:@x@wrangler.js'), execPath: 'node.exe' });
        expect(inv.error).toBeUndefined();
        expect(inv.shell).toBe(false);
        expect(inv.cmd).toBe('node.exe');
        expect(inv.args).toEqual([win('C:@x@wrangler.js'), 'r2', 'object', 'put', 'b/k', '--file', win('C:@Users@Jo Smith@t.txt'), '-c', 'wrangler.jsonc']);
    });
    it('on Windows without a wrangler script it falls back to a shell and refuses unsafe arguments', () => {
        const env = { platform: 'win32', wranglerBin: null, execPath: 'node.exe' };
        expect(mod.buildInvocation(['r2', 'object', 'put', 'b/k', '--file', win('C:@Users@Jo Smith@t.txt')], 'w.jsonc', env).error).toBeTruthy();
        expect(mod.buildInvocation(['secret', 'list'], 'a&b.jsonc', env).error).toBeTruthy();
        const ok = mod.buildInvocation(['secret', 'list', '--format', 'json'], 'wrangler.jsonc', env);
        expect(ok.error).toBeUndefined();
        expect(ok.shell).toBe(true);
    });
    it('on other platforms it never uses a shell', () => {
        const inv = mod.buildInvocation(['secret', 'list'], 'a b.jsonc', { platform: 'linux', wranglerBin: null, execPath: 'node' });
        expect(inv.shell).toBe(false);
        expect(inv.cmd).toBe('npx');
    });
});

describe('preflight: errors never echo input', () => {
    const run2 = async (argvExtra: string[], cfgText: string) => {
        const out: string[] = [];
        const err: string[] = [];
        statusCode = 200;
        statusBody = { status: 'ok', app: 'openinspection-core', version: '1.2.3' };
        for (const flag of [[], ['--json']]) {
            await mod.main(['--url', base, '--config', cfgFile(cfgText), ...argvExtra, ...flag], { stdout: (s) => out.push(s), stderr: (s) => err.push(s) }, { run: fakeRunner().run, tmpDir: dir });
        }
        return out.join('\n') + err.join('\n');
    };
    it('a malformed config with a short secret value prints a fixed message, not the parser text', async () => {
        const all = await run2([], '{"JWT_SECRET": hunter2x}');
        expect(all).not.toContain('hunter2x');
        expect(all).toMatch(/could not be read as JSONC/);
    });
    it('a crashing check prints no error text', async () => {
        const f = fakeRunner();
        const r = await mod.runPreflight({
            url: base, configPath: cfgFile(GOOD_CONFIG), run: f.run, tmpDir: dir,
            checks: [{ id: 'boom', run: async () => { throw new Error('leak-me-hunter2x'); } }],
        });
        expect(JSON.stringify(r)).not.toContain('hunter2x');
    });
    it('a failing secret list prints only the exit code, not stderr', async () => {
        const f = { run: async () => ({ status: 1, stdout: '', stderr: 'token hunter2x rejected' }) };
        const r = await mod.runPreflight({ url: base, configPath: cfgFile(GOOD_CONFIG), run: f.run, tmpDir: dir, only: ['jwt-keyring'] });
        expect(by(r, 'jwt-keyring').status).toBe('fail');
        expect(JSON.stringify(r)).not.toContain('hunter2x');
    });
});

describe('preflight: a probe that may have landed is reported', () => {
    it('tries a cleanup delete after a timed-out put and names the key and the manual command', async () => {
        const { report, f } = await run({}, { putTimesOutButLands: true });
        const c = by(report, 'photos-write');
        expect(c.status).toBe('fail');
        expect(f.calls.some((a) => a.slice(0, 3).join(' ') === 'r2 object delete')).toBe(true);
        expect(f.objects.size).toBe(0);
        expect(c.message).toContain('ETIMEDOUT');
        expect(c.message).toMatch(/preflight\//);
        expect(`${c.message} ${c.fix}`).toMatch(/wrangler r2 object delete my-photos\/preflight\//);
    });
});

describe('preflight: /status version shape', () => {
    it('accepts a pre-release version', async () => {
        statusBody = { status: 'ok', version: '1.2.3-rc.1' };
        const r = await mod.runPreflight({ url: base, configPath: cfgFile(GOOD_CONFIG), run: fakeRunner().run, tmpDir: dir, only: ['status'] });
        expect(by(r, 'status').status).toBe('pass');
    });
    it('rejects a version with trailing control characters or junk', async () => {
        for (const v of ['1.2.3\u001b[31mred', '1.2.3 and more', `1.2.3-${'a'.repeat(80)}\u0007`]) {
            statusBody = { status: 'ok', version: v };
            const r = await mod.runPreflight({ url: base, configPath: cfgFile(GOOD_CONFIG), run: fakeRunner().run, tmpDir: dir, only: ['status'] });
            expect(by(r, 'status').status).toBe('fail');
            expect(JSON.stringify(r)).not.toContain('\u001b');
        }
    });
    it('prints at most 40 characters of a long version', async () => {
        statusBody = { status: 'ok', version: `1.2.3-${'a'.repeat(100)}` };
        const r = await mod.runPreflight({ url: base, configPath: cfgFile(GOOD_CONFIG), run: fakeRunner().run, tmpDir: dir, only: ['status'] });
        expect(by(r, 'status').message).not.toContain('a'.repeat(41));
    });
});

describe('preflight: the probe does not put a temp path on the command line', () => {
    const FALLBACK = { platform: 'win32', wranglerBin: null, execPath: 'node.exe' };
    it('on the Windows shell fallback a temp directory with a space still reaches wrangler, by cwd and a relative file name', async () => {
        const spaced = join(dir, 'with space');
        mkdirSync(spaced, { recursive: true });
        const cfg = cfgFile(GOOD_CONFIG);
        const spawned: { cmd: string; args: string[]; o: Record<string, unknown> }[] = [];
        const spawn = (cmd: string, args: string[], o: Record<string, unknown>) => {
            spawned.push({ cmd, args, o });
            return { status: 0, stdout: '[]', stderr: '' };
        };
        const runner = mod.makeRunner(cfg, FALLBACK, spawn);
        const r = await mod.runPreflight({ url: base, configPath: cfg, run: runner, tmpDir: spaced, only: ['photos-write'] });
        expect(by(r, 'photos-write').status).toBe('pass');
        const put = spawned.find((s) => s.args.includes('put'));
        expect(put?.o.shell).toBe(true);
        expect(put?.args).toContain('probe.txt');
        expect(put?.args.join(' ')).not.toContain('with space');
        expect(String(put?.o.cwd)).toContain('with space');
    });
    it('a refused launch gets its own message and never blames the bucket or the token', async () => {
        const { report, f } = await run({}, { unsafeArg: true });
        const c = by(report, 'photos-write');
        expect(c.status).toBe('fail');
        expect(`${c.message} ${c.fix}`).toContain('could not be started safely');
        expect(`${c.message} ${c.fix}`).toContain('npm ci');
        expect(`${c.message} ${c.fix}`).not.toMatch(/bucket name|token|login/);
        expect(f.calls.filter((a) => a[2] === 'delete')).toEqual([]);
    });
    it('a refused launch of secret list gets the same message', async () => {
        const runner = async () => ({ status: 1, stdout: '', stderr: '', code: 'UNSAFE_ARG' });
        const r = await mod.runPreflight({ url: base, configPath: cfgFile(GOOD_CONFIG), run: runner, tmpDir: dir, only: ['jwt-keyring'] });
        expect(by(r, 'jwt-keyring').message).toContain('could not be started safely');
    });
});

describe('preflight: /status response handling', () => {
    it('fails on a response body over 64 KiB', async () => {
        statusBody = JSON.stringify({ status: 'ok', version: '1.2.3', pad: 'x'.repeat(200_000) });
        const r = await mod.runPreflight({ url: base, configPath: cfgFile(GOOD_CONFIG), run: fakeRunner().run, tmpDir: dir, only: ['status'] });
        expect(by(r, 'status').status).toBe('fail');
    });
    it('truncates a long version in the below-minimum message too', async () => {
        statusBody = { status: 'ok', version: `1.0.0-${'a'.repeat(100)}` };
        const r = await mod.runPreflight({ url: base, configPath: cfgFile(GOOD_CONFIG), run: fakeRunner().run, tmpDir: dir, only: ['status'], minVersion: '2.0.0' });
        expect(by(r, 'status').status).toBe('fail');
        expect(by(r, 'status').message).not.toContain('a'.repeat(41));
    });
    it('does not leave a double space when the connection error has a code', async () => {
        const r = await mod.runPreflight({ url: 'http://127.0.0.1:1', configPath: cfgFile(GOOD_CONFIG), run: fakeRunner().run, tmpDir: dir, only: ['status'] });
        expect(by(r, 'status').message).not.toContain('  ');
        expect(by(r, 'status').message.endsWith(' ')).toBe(false);
    });
    it.each([
        ['1.2.3-rc1', '1.2.3', 'fail'],
        ['1.2.3', '1.2.3-rc1', 'pass'],
        ['1.2.3-rc.2', '1.2.3-rc.10', 'fail'],
        ['1.2.3-rc.10', '1.2.3-rc.2', 'pass'],
        ['1.2.3-alpha', '1.2.3-alpha.1', 'fail'],
        ['1.2.4-rc1', '1.2.3', 'pass'],
    ])('version %s against minimum %s is %s', async (version, min, expected) => {
        statusBody = { status: 'ok', version };
        const r = await mod.runPreflight({ url: base, configPath: cfgFile(GOOD_CONFIG), run: fakeRunner().run, tmpDir: dir, only: ['status'], minVersion: min });
        expect(by(r, 'status').status).toBe(expected);
    });
});

describe('preflight: a config path cannot start like an option', () => {
    it.each(['-x.jsonc', '--remote'])('rejects %s without calling the runner', async (p) => {
        // The file must exist, so only the first-character rule can be what rejects it.
        const before = process.cwd();
        writeFileSync(join(dir, p), GOOD_CONFIG);
        process.chdir(dir);
        try {
            const f = fakeRunner();
            const r = await mod.runPreflight({ url: base, configPath: p, run: f.run, tmpDir: dir });
            expect(f.calls).toEqual([]);
            expect(by(r, 'config').status).toBe('fail');
            expect(r.exitCode).toBe(1);
        } finally {
            process.chdir(before);
        }
    });
});
