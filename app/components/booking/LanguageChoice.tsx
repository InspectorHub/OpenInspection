/**
 * "Which language would you like us to use?" — asked of the person booking,
 * on every public booking surface.
 *
 * NOTHING IS SELECTED BY DEFAULT, and that is the whole design. A
 * pre-selected English would turn every booking into a stated preference and
 * leave no way to tell who actually asked for one; the absence of a value is
 * the thing that makes a present value evidence. So `null` is a real state
 * here, not an empty one.
 *
 * The option labels come from the same table the Workspace and Profile
 * pickers use (`app/lib/locales.ts`), and the offered values from the same
 * list the server accepts, so there is one vocabulary for one choice.
 */
import { RadioGroup } from "@core/shared-ui";
import { SUPPORTED_CONTACT_LOCALES } from "../../../server/lib/i18n/contact-locale";
import { localeLabel } from "~/lib/locales";
import { m } from "~/paraglide/messages";

export function LanguageChoice({
  value,
  onChange,
  options = SUPPORTED_CONTACT_LOCALES,
  name = "locale",
  legendClassName = "block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1.5",
}: {
  /** The chosen tag, or `null` for "the client has not said". */
  value: string | null;
  onChange: (value: string) => void;
  options?: readonly string[];
  /** Radio group name — distinct per surface when two forms share a document. */
  name?: string;
  /** Defaults to the booking wizard's field-label idiom; the embed is tighter. */
  legendClassName?: string;
}) {
  return (
    <RadioGroup
      name={name}
      legend={m.booking_field_language_label()}
      legendClassName={legendClassName}
      // "" matches no option, which is how a native radio group renders the
      // unanswered state.
      value={value ?? ""}
      onChange={onChange}
      options={options.map((tag) => ({ value: tag, label: localeLabel(tag) }))}
    />
  );
}
