import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

const LIMIT_KB = 1024;
const isWin = os.platform() === 'win32';
const cmd = isWin ? 'npx.cmd' : 'npx';

function checkBundle({ label, cwd, args }) {
    return new Promise((resolve) => {
        // Note: do NOT set CI=true — newer wrangler (4.81+) reads CI as a
        // hint to also run `wrangler types`, which searches for the legacy
        // api/wrangler.toml path and ENOENT-aborts when we use -c with a
        // non-default config name. --dry-run is already non-interactive.
        const child = spawn(cmd, args, {
            cwd,
            shell: isWin,
            detached: !isWin,
        });
        let output = '';
        let killed = false;
        const finish = (ok, line) => {
            killed = true;
            try {
                if (isWin) execSync(`taskkill /pid ${child.pid} /T /F >nul 2>&1`);
                else process.kill(-child.pid);
            } catch {}
            console.log(line);
            resolve(ok);
        };

        child.stdout.on('data', (data) => {
            if (killed) return;
            output += data.toString();
            const match = output.match(/Total Upload:.*?gzip:\s*([\d.]+)/);
            if (match) {
                const sizeKb = parseFloat(match[1]);
                if (sizeKb >= LIMIT_KB) {
                    finish(false, `  ✗  ${label}: ${sizeKb} KiB gzip exceeds ${LIMIT_KB} KiB limit`);
                } else {
                    finish(true, `  ✓  ${label}: ${sizeKb} KiB gzip (limit ${LIMIT_KB} KiB)`);
                }
            }
        });

        child.stderr.on('data', (data) => {
            if (!killed) output += data.toString();
        });

        child.on('close', () => {
            if (killed) return;
            // Windows + shell:true spawn can fire `close` before the final
            // stdout chunks land on the data event. Re-check the accumulated
            // output one more time before reporting failure.
            const match = output.match(/Total Upload:.*?gzip:\s*([\d.]+)/);
            if (match) {
                const sizeKb = parseFloat(match[1]);
                if (sizeKb >= LIMIT_KB) {
                    console.log(`  ✗  ${label}: ${sizeKb} KiB gzip exceeds ${LIMIT_KB} KiB limit`);
                    resolve(false);
                } else {
                    console.log(`  ✓  ${label}: ${sizeKb} KiB gzip (limit ${LIMIT_KB} KiB)`);
                    resolve(true);
                }
                return;
            }
            console.error(`  ✗  ${label}: wrangler dry-run failed or "Total Upload" line not found`);
            console.error(`  …  last 500 chars of output: ${output.slice(-500).replace(/\n/g, '\\n')}`);
            resolve(false);
        });

        child.on('error', (err) => {
            console.error(`  ✗  ${label}: wrangler spawn error:`, err.message);
            resolve(false);
        });
    });
}

(async () => {
    // Measure against the standalone configs; saas bundle is functionally
    // identical (same source files, different env vars + worker name).
    console.log('  →  Bundle size: API');
    const apiOk = await checkBundle({
        label: 'API',
        cwd: process.cwd(),
        args: ['wrangler', 'deploy', '--dry-run', '--outdir', 'dist', '--config', 'wrangler.standalone.toml'],
    });

    console.log('  →  Bundle size: Web');
    const frontendDir = join(process.cwd(), 'frontend');
    const frontendBuild = join(frontendDir, 'build', 'client');
    let webOk = true;
    if (!existsSync(frontendBuild)) {
        console.log('  ⚠  Web: frontend/build/client missing — run `cd frontend && npx react-router build` for an accurate measurement (skipped).');
    } else {
        // Default wrangler.toml lookup (no --config) is required for
        // wrangler's react-router framework auto-detection to resolve
        // `virtual:react-router/server-build`. The base config is the
        // standalone deploy; the saas bundle is byte-identical at the
        // source level, so checking once is sufficient.
        webOk = await checkBundle({
            label: 'Web',
            cwd: frontendDir,
            args: ['wrangler', 'deploy', '--dry-run', '--outdir', 'dist'],
        });
    }

    process.exit(apiOk && webOk ? 0 : 1);
})();
