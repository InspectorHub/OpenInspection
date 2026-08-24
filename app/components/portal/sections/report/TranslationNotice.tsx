/**
 * <TranslationNotice> — the notice that travels with a courtesy translation,
 * and the control that switches between the two halves.
 *
 * ## Three things that are requirements, not style
 *
 *  1. **Permanent and non-dismissible.** No `<details>`, no close button, no
 *     "don't show again". This is the sentence that tells a reader WHICH
 *     DOCUMENT IS THE RECORD; a notice a reader can close once and never see
 *     again is the state it exists to prevent. The co-located test asserts the
 *     absence of a dismiss control — as "the only control in here is the
 *     toggle", not as "there is no button called dismiss", because the next one
 *     added will not be called that.
 *  2. **`role="note"`, explicitly.** No element maps to that role implicitly,
 *     so without it `getByRole('note')` never finds this and every E2E
 *     assertion about the notice silently passes over nothing.
 *  3. **The wording comes from the server.** It is a versioned legal constant
 *     resolved through the reviewed-constant register, never a catalogue
 *     string: the sentence that says a translation is unofficial must not be
 *     produced by an ordinary translation pass. Only the CHROME around it — the
 *     button label — is catalogue copy.
 *
 * ⚠️ `notice.locale` is not the same as the report's translated locale. Until a
 * qualified legal translator has reviewed a per-language wording, a Spanish
 * reader is shown the ENGLISH notice, and that is correct rather than a gap:
 * the English is the record, so showing it is showing the thing itself.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { m } from "~/paraglide/messages";
import { useAnchorId } from "./report-half-scope";

export interface TranslationNoticeProps {
  /** The notice text, resolved server-side. */
  notice: { locale: string; title: string; text: string };
  /** Which half the reader is currently looking at. */
  showingTranslation: boolean;
  /** BCP-47 tag of the translated half, e.g. `es-419`. */
  translationLocale: string;
  onToggle: () => void;
  /** Headless PDF render: both halves are in the file, so there is no toggle. */
  printMode?: boolean;
  /**
   * Which half of a PRINTED file this notice heads, when there are two.
   *
   * Undefined on screen, where there is only ever one half and the toggle
   * already says which. In print it is load-bearing: both halves open with the
   * same masthead, the same address and the same notice, so without a line
   * naming the half a reader turning to the seam sees the report apparently
   * starting over. Caught by reading an actual render, not by any assertion.
   */
  half?: "en" | "translated";
}

export function TranslationNotice({
  notice,
  showingTranslation,
  translationLocale,
  onToggle,
  printMode = false,
  half,
}: TranslationNoticeProps) {
  // The printed file carries this block TWICE — once at the head of each half —
  // so its heading id is namespaced like every other anchor in the document.
  // `aria-labelledby` pointing at the other half's heading is the kind of
  // breakage that only a screen reader would ever report.
  const anchorId = useAnchorId();
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 mb-6">
      <section
        role="note"
        data-testid="courtesy-translation-notice"
        data-notice-locale={notice.locale}
        data-showing={showingTranslation ? translationLocale : "en"}
        aria-labelledby={anchorId("courtesy-translation-heading")}
        className="border border-ih-border rounded-xl p-5 bg-ih-bg-card"
      >
        <h2
          id={anchorId("courtesy-translation-heading")}
          className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-2"
        >
          {notice.title}
        </h2>
        {/* Verbatim, and never truncated. It is the whole point of the block. */}
        <p lang={notice.locale} className="text-[13px] leading-relaxed text-ih-fg-2">
          {notice.text}
        </p>

        {/* Where the reader is in a two-half file. CHROME, not the notice: the
            notice text is a versioned constant and nothing may be appended to
            it, so this is a separate sentence from the catalogue that says
            which half this is and that the other one is in the same file. */}
        {half && (
          <p data-testid="courtesy-translation-half-note" className="mt-2 text-[12px] leading-relaxed text-ih-fg-3">
            {half === "translated"
              ? m.courtesy_translation_print_seam()
              : m.courtesy_translation_print_continues()}
          </p>
        )}

        {/* No dismiss control, deliberately — see the header. The only control
            is the one that changes which half is on screen. */}
        {!printMode && (
          <button
            type="button"
            onClick={onToggle}
            data-testid="courtesy-translation-toggle"
            aria-pressed={showingTranslation}
            className="mt-3 inline-flex h-8 items-center px-3 rounded-lg border border-ih-border bg-ih-bg-card text-[12px] font-semibold text-ih-fg-2 hover:text-ih-fg-1 transition-colors"
          >
            {showingTranslation
              ? m.courtesy_translation_show_english()
              : m.courtesy_translation_show()}
          </button>
        )}
      </section>
    </div>
  );
}

/**
 * <EnglishSpanBadge> — the marker on a span that stays English inside the
 * translated half.
 *
 * A translated deliverable is MIXED-LANGUAGE by construction: the reliance
 * restrictions, the per-section disclaimers and the limitations tabs are part
 * of the inspection record itself and are never machine-translated. This is a
 * design requirement rather than a rendering detail — a reader who sees an
 * English paragraph in the middle of Spanish prose and concludes the
 * translation is broken will discount the notice too.
 *
 * Renders nothing when the reader is looking at the English half, where every
 * span is English and a badge on some of them would be noise.
 */
export function EnglishSpanBadge({ showing }: { showing: boolean }) {
  if (!showing) return null;
  return (
    <span
      data-testid="english-span-badge"
      title={m.courtesy_translation_english_span_why()}
      className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 border border-ih-border text-[10px] font-semibold uppercase tracking-wider text-ih-fg-3 align-middle"
    >
      {m.courtesy_translation_english_span()}
    </span>
  );
}
