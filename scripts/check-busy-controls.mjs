#!/usr/bin/env node
/**
 * A control that starts work must stay focusable and must not double-submit.
 *
 * Flags, in app/**\/*.tsx (tests excluded):
 *  - <button|Button type="submit"> with none of pending / pendingProps / disabled /
 *    aria-disabled / aria-busy (no busy protection at all);
 *  - <button|Button disabled={...busy-ish...}>: a native disable drops keyboard focus to
 *    <body> mid-flight. Use <Button pending> or {...pendingProps(busy, onClick)} with
 *    PENDING_CLASS from "@core/shared-ui" (aria-disabled plus an inert click).
 *
 * The opening tag is parsed for real (multi-line, nested braces), not matched per line.
 * Exception: a comment `busy-controls-allow: <reason>` on the tag's lines or the two above;
 * the reason is mandatory. Baseline: scripts/busy-controls-baseline.json ({ path: count }),
 * expected to stay {}.
 *
 * Detector and its tests: scripts/lib/busy-controls-detect.mjs, tests/unit/tooling/busy-controls-gate.spec.ts
 */
import { detectBusyControls } from './lib/busy-controls-detect.mjs';
import { runJsxGate } from './lib/jsx-gate-runner.mjs';

runJsxGate({
    name: 'busy-controls',
    baselineFile: 'scripts/busy-controls-baseline.json',
    detect: (src) => {
        const r = detectBusyControls(src);
        return { sites: r.sites, violations: r.violations };
    },
    control: '<button type="submit">Save</button><Button disabled={isSaving}>Go</Button>',
    controlMin: 2,
    fixHint: [
        'Use <Button pending={busy}> or <button {...pendingProps(busy, onClick)} className={PENDING_CLASS}>',
        'from "@core/shared-ui". If a control genuinely needs neither, write',
        '`// busy-controls-allow: <reason>` above it. Do not add to the baseline.',
    ],
});
