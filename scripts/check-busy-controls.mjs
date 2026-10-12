#!/usr/bin/env node
/**
 * A control that starts work must stay focusable and must not double-submit.
 *
 * Flags, in app/**\/*.tsx and packages/shared-ui/src/**\/*.tsx (tests excluded):
 *  - <button|Button> that submits (type="submit", a `type=` expression naming "submit", or a bare
 *    <button> inside a form) with none of pending / pendingProps / disabled (aria-disabled and
 *    aria-busy alone do not stop a click or Enter);
 *  - <button|Button disabled={...busy-ish...}>: a native disable drops keyboard focus to
 *    <body> mid-flight. Use <Button pending> or {...pendingProps(busy, onClick)} with
 *    PENDING_CLASS from "@core/shared-ui" (aria-disabled plus an inert click).
 *
 * The opening tag is parsed for real (multi-line, nested braces), not matched per line.
 * Exception: a comment `busy-controls-allow: <reason>` inside the tag or just above it (it exempts
 * exactly the next opening tag); the reason is mandatory. Wrapper components are out of scope
 * (see scripts/lib/busy-controls-detect.mjs). Baseline: scripts/busy-controls-baseline.json ({ path: count }),
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
    controls: [
        { rule: 'submit-unprotected', src: '<button type="submit">Save</button>' },
        { rule: 'native-disable-busy', src: '<Button disabled={isSaving}>Go</Button>' },
    ],
    fixHint: [
        'Use <Button pending={busy}> or <button {...pendingProps(busy, onClick)} className={PENDING_CLASS}>',
        'from "@core/shared-ui". If a control genuinely needs neither, write',
        '`// busy-controls-allow: <reason>` above it. Do not add to the baseline.',
    ],
});
