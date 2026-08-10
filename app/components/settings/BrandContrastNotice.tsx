import { AA_NORMAL, fillContrast } from "~/lib/brand";
import { formatNumber } from "~/lib/format";
import { m } from "~/paraglide/messages";

/**
 * "This colour cannot carry readable text" hint under the brand colour picker
 * (#91).
 *
 * ── Why a warning and not a correction ──
 * `--ih-primary` is the FILL role and stays the tenant's exact hex: that is the
 * whole point of the token split (see `brandTokens`). Substituting a nearby
 * colour would be changing someone's brand behind their back; refusing the save
 * would be deciding for them. So the control reviews, it does not accept on
 * their behalf — it states the measured consequence and leaves the choice where
 * it belongs.
 *
 * ── Why it is not "low contrast" ──
 * The message carries the number `contrastForeground` will actually achieve on
 * this fill, and the number AA asks for, because a vague warning is dismissed
 * and a measured one is considered. It also says what is NOT damaged: brand-
 * coloured TEXT is derived to clear AA (`brandTextColor`), so links and accent
 * text stay readable no matter what is picked. Overstating the damage would get
 * this ignored just as fast as understating it.
 *
 * ── Live AND persistent ──
 * The component is a pure function of the colour currently in the picker, which
 * the settings page seeds from the stored value. So it appears while choosing
 * and is still there on every later visit — which is the point: the person who
 * has to answer "why are our buttons hard to read" is usually not the person
 * who picked the colour, and often not on the day they picked it.
 */
export function BrandContrastNotice({
  color,
  locale = "en-US",
}: {
  /** The colour currently in the picker (`#rgb` / `#rrggbb`). */
  color: string | null | undefined;
  /** Viewer locale for the two ratio figures. */
  locale?: string;
}) {
  const fill = fillContrast(color);
  // Unparseable → nothing measured, so nothing claimed. Clears AA → silence:
  // a notice that is always present is decoration, not information.
  if (!fill || fill.meetsAA) return null;

  const ratio = (n: number) => formatNumber(Math.round(n * 100) / 100, { locale });

  return (
    <div role="status" className="mt-1 space-y-1">
      <p className="text-xs font-semibold text-ih-watch-fg">
        {m.settings_workspace_color_contrast_warning({
          ratio: ratio(fill.ratio),
          aa: ratio(AA_NORMAL),
        })}
      </p>
      <p className="text-xs text-ih-fg-3">{m.settings_workspace_color_contrast_scope()}</p>
    </div>
  );
}
