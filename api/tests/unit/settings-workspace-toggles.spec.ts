/**
 * Round-2 backlog #10 — Settings → Workspace → Reports renders four toggles
 * (Show estimates, Enable Repair List, Block unpaid, Block unsigned agreement)
 * in deterministic order. Pre-checks reflect persisted policy state so the UI
 * doesn't flash off-then-on after hydration.
 */
import { describe, it, expect } from 'vitest';
import { SettingsWorkspacePage } from '../../src/templates/pages/settings-workspace';

/**
 * hono/jsx returns a JSXNode whose toString() materialises full HTML —
 * we coerce via String() to inspect the rendered markup. This mirrors the
 * pattern used in `tests/unit/page-header.spec.ts`.
 */
function render(node: unknown): string {
    return String(node);
}

describe('SettingsWorkspacePage — Round-2 #10 block-report toggles', () => {
    it('renders 4 toggles on Reports sub-page in deterministic order', () => {
        const html = render(SettingsWorkspacePage({
            subPage: 'reports',
            branding: undefined,
            showEstimates: false,
            enableRepairList: false,
            blockUnpaid: false,
            blockUnsignedAgreement: false,
        }));

        const showEstimatesIdx = html.indexOf('settings-show-estimates-toggle');
        const enableRepairIdx  = html.indexOf('settings-enable-repair-list-toggle');
        const blockUnpaidIdx   = html.indexOf('settings-block-unpaid-toggle');
        const blockUnsignedIdx = html.indexOf('settings-block-unsigned-agreement-toggle');

        expect(showEstimatesIdx).toBeGreaterThan(-1);
        expect(enableRepairIdx).toBeGreaterThan(showEstimatesIdx);
        expect(blockUnpaidIdx).toBeGreaterThan(enableRepairIdx);
        expect(blockUnsignedIdx).toBeGreaterThan(blockUnpaidIdx);
    });

    it('toggles are pre-checked when policy is true', () => {
        const html = render(SettingsWorkspacePage({
            subPage: 'reports',
            branding: undefined,
            showEstimates: true,
            enableRepairList: true,
            blockUnpaid: true,
            blockUnsignedAgreement: true,
        }));

        // The block-unpaid toggle should be marked checked when policy=true.
        // We slice ~400 chars after the testid attribute to keep the regex
        // localised to the new toggle's <input> element.
        const blockUnpaidIdx = html.indexOf('settings-block-unpaid-toggle');
        expect(blockUnpaidIdx).toBeGreaterThan(-1);
        const blockUnpaidSlice = html.slice(blockUnpaidIdx, blockUnpaidIdx + 400);
        expect(blockUnpaidSlice).toMatch(/checked/);

        const blockUnsignedIdx = html.indexOf('settings-block-unsigned-agreement-toggle');
        expect(blockUnsignedIdx).toBeGreaterThan(-1);
        const blockUnsignedSlice = html.slice(blockUnsignedIdx, blockUnsignedIdx + 400);
        expect(blockUnsignedSlice).toMatch(/checked/);
    });

    it('new toggles are NOT pre-checked when policy is false', () => {
        const html = render(SettingsWorkspacePage({
            subPage: 'reports',
            branding: undefined,
            showEstimates: false,
            enableRepairList: false,
            blockUnpaid: false,
            blockUnsignedAgreement: false,
        }));

        const blockUnpaidIdx = html.indexOf('settings-block-unpaid-toggle');
        const blockUnpaidSlice = html.slice(blockUnpaidIdx, blockUnpaidIdx + 400);
        // Conditional spread pattern only emits `checked` attribute when true.
        expect(blockUnpaidSlice).not.toMatch(/\schecked(\s|=|>|")/);
    });
});
