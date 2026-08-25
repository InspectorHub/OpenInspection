// @vitest-environment happy-dom
/**
 * The notice that travels with a courtesy translation, and the control it does
 * NOT have.
 *
 * <TranslationNotice>'s header states three things as requirements rather than
 * style, and the first of them — permanent, non-dismissible — is the one that
 * disappears silently. Nothing breaks when a close button is added: the
 * component still renders, every E2E that looks for the notice still finds it
 * on first paint, and the sentence that tells a reader WHICH DOCUMENT IS THE
 * RECORD becomes something they can turn off once and never see again.
 *
 * The absence is asserted as "the only control in here is the toggle", not as
 * "there is no button called dismiss". The next one to be added will not be
 * called dismiss — it will be a `<details>`, an ✕, a "got it", or a link — and
 * a named check would pass over all four.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TranslationNotice, EnglishSpanBadge } from './TranslationNotice';

const notice = {
    locale: 'en',
    title: 'Courtesy Translation of Inspection Report',
    text: 'This translation is provided as a courtesy. The English report is the inspection record.',
};

function renderNotice(overrides: Partial<Parameters<typeof TranslationNotice>[0]> = {}) {
    return render(
        <TranslationNotice
            notice={notice}
            showingTranslation={false}
            translationLocale="es-419"
            onToggle={() => {}}
            {...overrides}
        />,
    );
}

/** Anything a reader can press, click or open, anywhere inside the notice. */
const controlsIn = (container: HTMLElement) =>
    Array.from(container.querySelectorAll(
        'button, a, input, select, [role="button"], [role="link"], details, summary, [aria-expanded]',
    ));

describe('TranslationNotice', () => {
    it('offers NO way to dismiss it — the only control is the half toggle', () => {
        const { container } = renderNotice();

        const controls = controlsIn(container);
        expect(
            controls.map((el) => `${el.tagName.toLowerCase()}[${el.getAttribute('data-testid') ?? ''}]`),
            'the notice must carry exactly one control, and it must be the toggle',
        ).toEqual(['button[courtesy-translation-toggle]']);

        // Belt and braces on the two shapes a dismiss control actually takes in
        // this codebase: a disclosure widget that collapses the whole block, and
        // a hiding attribute on the section itself.
        expect(container.querySelectorAll('details, summary').length).toBe(0);
        const section = container.querySelector('[data-testid="courtesy-translation-notice"]')!;
        expect(section.hasAttribute('hidden')).toBe(false);
        expect(section.getAttribute('aria-hidden')).toBeNull();
    });

    it('offers no control at all in print, where there is nothing to switch to', () => {
        // Both halves are in the printed file, so a toggle there would print a
        // dead button onto paper — and a dismiss control would be worse, since
        // paper cannot be un-dismissed.
        const { container } = renderNotice({ printMode: true, half: 'en' });
        expect(controlsIn(container)).toEqual([]);
        expect(container.querySelector('[data-testid="courtesy-translation-notice"]')).not.toBeNull();
    });

    it('survives a re-render into the other half still carrying no dismiss control', () => {
        // The half a reader is looking at is state on the page, so the notice is
        // re-rendered every time they press the toggle. A control that appears
        // only in the translated half would be invisible to a test that renders
        // the default one.
        const { container, rerender } = renderNotice();
        rerender(
            <TranslationNotice
                notice={notice}
                showingTranslation
                translationLocale="es-419"
                onToggle={() => {}}
            />,
        );
        expect(controlsIn(container).map((el) => el.getAttribute('data-testid')))
            .toEqual(['courtesy-translation-toggle']);
        expect(container.querySelector('[data-testid="courtesy-translation-notice"]')!
            .getAttribute('data-showing')).toBe('es-419');
    });

    it('carries role="note" explicitly, because no element maps to it implicitly', () => {
        // Requirement 2 in the component's header, and it is load-bearing for
        // the E2E: without the attribute `getByRole('note')` matches nothing and
        // every assertion counting notices passes over an empty set.
        const { getAllByRole } = renderNotice();
        expect(getAllByRole('note')).toHaveLength(1);
    });

    it('renders the server-resolved wording verbatim, and tags it with its own language', () => {
        // Requirement 3: the sentence saying a translation is unofficial is a
        // versioned legal constant, so it is never truncated, summarised or
        // re-expressed here. `notice.locale` is the language of the NOTICE, not
        // of the half — today a Spanish reader is shown the English notice, and
        // that is correct rather than a gap.
        const { container } = renderNotice({ showingTranslation: true });
        const paragraph = container.querySelector(`p[lang="${notice.locale}"]`);
        expect(paragraph?.textContent).toBe(notice.text);
        expect(container.querySelector('[data-notice-locale]')!.getAttribute('data-notice-locale'))
            .toBe(notice.locale);
    });
});

describe('EnglishSpanBadge', () => {
    it('marks an English span inside the translated half, and nothing in the English one', () => {
        // A reader who meets an English paragraph in the middle of Spanish prose
        // and concludes the translation is broken discounts the notice with it.
        // On the English half every span is English, so a badge is noise.
        expect(render(<EnglishSpanBadge showing />).container.firstChild).not.toBeNull();
        expect(render(<EnglishSpanBadge showing={false} />).container.firstChild).toBeNull();
    });
});
