// @vitest-environment happy-dom
/**
 * OI #271 condition 4 (the page half) and condition 5 — the report page tells
 * the recipient what is recorded, what is not, and how to stop it.
 *
 * These assertions are deliberately about the SHAPE of the notice rather than
 * its exact prose, except where the prose is the requirement:
 *
 *  - The limit sentence is checked for the three absences by name. LIA §2 and
 *    §3.3 pass BECAUSE the IP address, the device signal and the per-finding
 *    trail do not exist; a notice that states only the fact understates the
 *    design, and that regression is invisible to any test that just looks for
 *    "a disclosure".
 *  - The exit is checked for "keep your report". An objection answered by
 *    revoking the link is the remedy external review rejected; the code refuses
 *    it, and this stops the copy layer from putting it back.
 *  - The notice must NOT be inside a <details>. "Plain and permanent" is the
 *    requirement — a disclosure a reader has to open is one most readers never
 *    see.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { ReportViewDisclosure } from './ReportViewDisclosure';
import { REPORT_VIEW_DISCLOSURE_VERSION } from './report-view-disclosure-version';

function mount(props: Parameters<typeof ReportViewDisclosure>[0] = {}) {
    const Stub = createRoutesStub([
        { path: '/', Component: () => <ReportViewDisclosure {...props} /> },
    ]);
    return render(<Stub initialEntries={['/']} />);
}

describe('<ReportViewDisclosure>', () => {
    it('states the fact, then the limit, then the exit', () => {
        const { container } = mount();
        const text = container.textContent ?? '';
        const fact = text.indexOf('we record that it was opened');
        const limit = text.indexOf('Nothing else is recorded');
        const exit = text.indexOf('keep your report');
        expect(fact).toBeGreaterThan(-1);
        expect(limit).toBeGreaterThan(fact);
        expect(exit).toBeGreaterThan(limit);
    });

    it('names the three things that are NOT recorded', () => {
        const text = mount().container.textContent ?? '';
        expect(text).toContain('no IP address');
        expect(text).toContain('no device information');
        expect(text).toContain('which findings you read');
    });

    it('offers the exit as a control, not as a link that takes the report away', () => {
        const { getByRole, container } = mount();
        expect(getByRole('button', { name: /turn off open tracking/i })).toBeTruthy();
        // Nothing here may look like "click to lose access".
        expect(container.textContent ?? '').not.toMatch(/revoke|expire|lose access/i);
    });

    it('is the anchor the emailed exit link points at', () => {
        // The email's exit is `<reportUrl>#view-tracking`. If this id moves, the
        // link in every already-delivered message lands nowhere.
        expect(mount().container.querySelector('#view-tracking')).toBeTruthy();
    });

    it('is permanent, not tucked inside a disclosure widget', () => {
        expect(mount().container.querySelector('details')).toBeNull();
    });

    it('stamps the disclosure version onto the rendered notice', () => {
        const el = mount().container.querySelector('[data-disclosure-version]');
        expect(el?.getAttribute('data-disclosure-version')).toBe(String(REPORT_VIEW_DISCLOSURE_VERSION));
    });

    it('says so plainly once the recipient has objected, and offers the way back', () => {
        const { getByRole, container } = mount({ objected: true });
        expect(container.textContent ?? '').toContain('Open tracking is off for you');
        // Art. 21 is not Art. 17 — history is untouched, and the notice says so
        // rather than letting the reader assume the counters were wiped.
        expect(container.textContent ?? '').toContain('unchanged');
        expect(getByRole('button', { name: /turn open tracking back on/i })).toBeTruthy();
    });

    it('renders nothing in print mode', () => {
        // The PDF is a document the recipient keeps; a live control in it is a
        // dead control. The emailed notice and the web page both carry the
        // disclosure, so nothing is lost.
        const { container } = mount({ printMode: true });
        expect(container.querySelector('#view-tracking')).toBeNull();
    });
});
