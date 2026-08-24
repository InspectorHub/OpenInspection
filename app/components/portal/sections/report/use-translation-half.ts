/**
 * Which HALF of a translated report the reader is looking at.
 *
 * A hook rather than inline state in <ReportView>, for the reason every piece
 * of that component's state that has a name of its own lives next door: the
 * component is already at the large-file limit, and "which language half is on
 * screen" is a thing a reader would look up by name.
 *
 * ## English is the default, always
 *
 * A reader who lands on a machine translation without having asked for one has
 * been handed a reading aid dressed as the document. The English report is the
 * inspection record, so it is what renders until somebody presses the control.
 *
 * ## Nothing here decides what may be translated
 *
 * The payload arrives with the SERVER'S paths. Which spans were eligible was
 * settled by the segmenter; re-deriving that in the browser would be a second
 * implementation of the rule, and the two would drift the day either changed.
 *
 * ## `forced` is for the printed file, where BOTH halves exist at once
 *
 * On screen a reader is looking at one half and a control moves them between
 * the two. On paper there is no control: the file carries the English record
 * and then the courtesy translation, so the same component renders twice and
 * each render is TOLD which half it is. `forced` says so; there is no state to
 * toggle in that case and pressing nothing can change it.
 */
import { useMemo, useState } from "react";
import { applyCourtesyTranslation, type CourtesyTranslationPayload } from "~/lib/report-translation";

/** The three collections a translation can reach. */
interface TranslatableParts {
  sections: unknown;
  outline: unknown;
  photoAppendix: unknown;
}

export interface TranslationHalf<T extends TranslatableParts> {
  /** The translation, or null when there is none to offer. */
  courtesy: CourtesyTranslationPayload | null;
  /** True while the translated half is on screen. False with no translation. */
  showingTranslation: boolean;
  /** The three collections, translated or not. Spread over the report props. */
  parts: T;
  toggle: () => void;
}

export function useTranslationHalf<T extends TranslatableParts>(
  parts: T,
  courtesyTranslation: CourtesyTranslationPayload | null | undefined,
  /** Pin the half instead of letting the reader choose. See the header. */
  forced?: "en" | "translated",
): TranslationHalf<T> {
  const [showTranslation, setShowTranslation] = useState(false);
  const courtesy = courtesyTranslation ?? null;
  const translated = useMemo(
    () => applyCourtesyTranslation(parts, courtesy).payload,
    [parts, courtesy],
  );
  const chosen = forced === undefined ? showTranslation : forced === "translated";
  const showingTranslation = chosen && courtesy != null;
  return {
    courtesy,
    showingTranslation,
    parts: showingTranslation ? translated : parts,
    toggle: () => setShowTranslation((v) => !v),
  };
}
