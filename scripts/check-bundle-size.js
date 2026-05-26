import { spawn, execSync } from 'child_process';
import os from 'os';

console.log('  →  Bundle size check');

const isWin = os.platform() === 'win32';
const cmd = isWin ? 'npx.cmd' : 'npx';

const child = spawn(cmd, ['wrangler', 'deploy', '--dry-run', '--outdir', 'dist'], {
    env: { ...process.env, CI: 'true' },
    shell: isWin,
    detached: !isWin // use detached on posix to kill process group
});

let output = '';
let killed = false;

child.stdout.on('data', (data) => {
    if (killed) return;
    output += data.toString();
    const match = output.match(/Total Upload:.*?gzip:\s*([\d.]+)/);
    if (match) {
        killed = true;
        const sizeKb = parseFloat(match[1]);
        if (sizeKb >= 1024) {
            console.error(`\n  ✗  Bundle too large: ${sizeKb} KiB gzip (limit: 1024 KiB)`);
            killProcessAndExit(1);
        } else {
            console.log(`\n  ✓  Bundle size: ${sizeKb} KiB gzip (limit: 1024 KiB)`);
            killProcessAndExit(0);
        }
    }
});

child.stderr.on('data', (data) => {
    if (!killed) output += data.toString();
});

child.on('close', (code) => {
    if (!killed) {
        console.error('  ✗  Bundle build failed or "Total Upload" line not found');
        process.exit(1);
    }
});

child.on('error', (err) => {
    console.error('  ✗  Failed to start wrangler:', err);
    process.exit(1);
});

function killProcessAndExit(exitCode) {
    try {
        if (isWin) {
            execSync(`taskkill /pid ${child.pid} /T /F >nul 2>&1`);
        } else {
            process.kill(-child.pid);
        }
    } catch (e) {
        // ignore errors during kill
    }
    process.exit(exitCode);
}
