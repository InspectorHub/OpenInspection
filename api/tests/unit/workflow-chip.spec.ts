/**
 * Design System 0520 subsystem B phase 6 task 6.6 — WorkflowChip smoke.
 *
 * The component is pure JSX without internal logic — but the state→tone
 * mapping is the contract that consumers depend on. Renders the
 * component to string + asserts the tone class is present.
 */
import { describe, it, expect } from 'vitest';
import { WorkflowChip } from '../../src/templates/components/workflow-chip';

const renderTo = (state: 'agreement' | 'payment' | 'apprentice-review' | 'published' | 'cancelled' | 'draft', label?: string) => {
    const out = WorkflowChip({ state, ...(label !== undefined ? { label } : {}) }) as unknown as { toString(): string };
    return String(out);
};

describe('WorkflowChip tone mapping (subsystem B P6 T6.6)', () => {
    it('agreement → amber (ih-pill--monitor)', () => {
        expect(renderTo('agreement')).toMatch(/ih-pill--monitor/);
    });
    it('payment → sky (ih-pill--info)', () => {
        expect(renderTo('payment')).toMatch(/ih-pill--info/);
    });
    it('apprentice-review → amber', () => {
        expect(renderTo('apprentice-review')).toMatch(/ih-pill--monitor/);
    });
    it('published → green (ih-pill--sat)', () => {
        expect(renderTo('published')).toMatch(/ih-pill--sat/);
    });
    it('cancelled → rose (ih-pill--defect)', () => {
        expect(renderTo('cancelled')).toMatch(/ih-pill--defect/);
    });
    it('draft → slate (ih-pill--gen)', () => {
        expect(renderTo('draft')).toMatch(/ih-pill--gen/);
    });
    it('custom label override is rendered', () => {
        expect(renderTo('payment', 'Awaiting deposit')).toMatch(/Awaiting deposit/);
    });
    it('default label matches state', () => {
        expect(renderTo('agreement')).toMatch(/Agreement/);
    });
});
