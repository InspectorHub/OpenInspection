#!/usr/bin/env node
/**
 * Nothing a keyboard user can reach may be invisible or parked off-screen but still focusable.
 *
 * Flags, in app/**\/*.tsx and packages/shared-ui/src/**\/*.tsx (tests excluded):
 *  - className with opacity-0 revealed only by a hover:/group-hover: opacity-N variant (any variant
 *    prefixes) and no focus reveal (focus-within:, or focus:/focus-visible: on a focusable element);
 *  - the same reveal on a button / link (or an element containing one) with no
 *    [@media(hover:none)]:opacity-100, so touch devices never see it;
 *  - an element whose className holds translate-y-full / translate-x-full / -translate-x-full
 *    (a panel parked off-screen) without `inert` on the same element. See
 *    app/components/MobileBottomDrawer.tsx.
 *
 * Exception: a comment `hidden-focusable-allow: <reason>` inside the tag or just above it
 * (exempts exactly the next opening tag); the reason is mandatory. Baseline: scripts/hidden-focusable-baseline.json
 * ({ path: count }), expected to stay {}.
 *
 * Detector and its tests: scripts/lib/hidden-focusable-detect.mjs, tests/unit/tooling/hidden-focusable-gate.spec.ts
 */
import { detectHiddenFocusable } from './lib/hidden-focusable-detect.mjs';
import { runJsxGate } from './lib/jsx-gate-runner.mjs';

runJsxGate({
    name: 'hidden-focusable',
    baselineFile: 'scripts/hidden-focusable-baseline.json',
    detect: detectHiddenFocusable,
    controls: [
        { rule: 'hover-only-reveal', src: '<div className="opacity-0 group-hover:opacity-100">x</div>' },
        { rule: 'hover-only-touch', src: '<button className="opacity-0 group-hover:opacity-100 focus-within:opacity-100">x</button>' },
        { rule: 'parked-not-inert', src: '<div className="translate-y-full">x</div>' },
    ],
    fixHint: [
        'Add focus-within:opacity-100 (or focus-visible:opacity-100) beside the hover reveal, plus',
        '[@media(hover:none)]:opacity-100 when it holds a button or link. Add `inert` (and aria-hidden)',
        'to a parked panel while it is closed. If an element is genuinely correct, write',
        '`// hidden-focusable-allow: <reason>` above it. Do not add to the baseline.',
    ],
});
