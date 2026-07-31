import { Button } from "@core/shared-ui";
import { formatDate } from "~/lib/format";
import { m } from "~/paraglide/messages";

/**
 * Consent for the text channel — a different question from the Text column
 * beside it (spec §4.2).
 *
 * Consent answers *may we text you at all* and is the legal record; the grid
 * answers *which of those texts do you want*. Someone can consent to texts and
 * still not want booking confirmations, and the send gate reads them in that
 * order, so a screen showing both is the screen agreeing with the code.
 *
 * THERE IS NO "TURN BACK ON" BUTTON, and that is deliberate. Granting consent
 * means recording a disclosure version, a capture method, an ip and a user
 * agent — evidence only the opt-in page can honestly produce. A switch here
 * would be manufacturing it. Stopping needs no such ceremony, which is why it
 * IS a button.
 */

export type SmsConsentState = "granted" | "implied" | "revoked" | "none";

export interface SmsConsent {
    phone: string | null;
    state: SmsConsentState;
    at: string | null;
    capturedVia: "booking_form" | "optin_link" | "admin" | null;
}

const SOURCE = {
    booking_form: () => m.notif_prefs_source_booking_form(),
    optin_link: () => m.notif_prefs_source_optin_link(),
    admin: () => m.notif_prefs_source_admin(),
};

export function SmsConsentBlock({
    consent, manageHref, onStop, busy = false, locale = "en-US",
}: {
    consent: SmsConsent;
    /** The opt-in page — where consent can be granted with its disclosure. */
    manageHref?: string | undefined;
    onStop: () => void;
    busy?: boolean;
    /**
     * The APP's locale, passed in rather than read from a hook.
     *
     * `toLocaleDateString(undefined, …)` reads navigator.language and rendered
     * a Chinese date inside an otherwise-English page (caught in Chrome). The
     * obvious fix — `useDisplayLocale()` — needs route loader data, which the
     * token-authenticated client portal does not have. A prop works on all
     * three surfaces and keeps this component renderable on its own.
     */
    locale?: string;
}) {
    const day = (iso: string | null) => (iso ? formatDate(iso, { locale }) : "");
    const on = consent.state === "granted" || consent.state === "implied";

    return (
        <section aria-labelledby="notif-sms-h" className="bg-ih-bg-card border border-ih-border rounded-xl p-6">
            <h2 id="notif-sms-h" className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest">
                {m.notif_prefs_sms_heading()}
            </h2>

            <p className="text-[15px] text-ih-fg-1 mt-2">
                {consent.state === "revoked" ? m.notif_prefs_sms_revoked({ date: day(consent.at) })
                    : consent.state === "none" ? m.notif_prefs_sms_none()
                        : consent.phone ? m.notif_prefs_sms_on({ phone: consent.phone })
                            : m.notif_prefs_sms_on_no_phone()}
            </p>

            {/* The ledger line. It is the same fact a carrier audit would ask
                for, which is why showing it to the reader costs nothing and
                turns compliance evidence into something they benefit from. */}
            {consent.state === "granted" && consent.at && consent.capturedVia && (
                <p className="text-[13px] text-ih-fg-3 mt-1">
                    {m.notif_prefs_sms_captured({
                        date: day(consent.at),
                        source: SOURCE[consent.capturedVia](),
                    })}
                </p>
            )}
            {consent.state === "implied" && (
                <p className="text-[13px] text-ih-fg-3 mt-1">{m.notif_prefs_sms_implied()}</p>
            )}

            <div className="flex items-center gap-3 mt-4 flex-wrap">
                {on && (
                    <Button variant="secondary" onClick={onStop} disabled={busy}>
                        {m.notif_prefs_sms_stop()}
                    </Button>
                )}
                {manageHref && (
                    <a
                        href={manageHref}
                        className="text-[13px] font-semibold text-ih-primary hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ih-primary rounded-sm"
                    >
                        {m.notif_prefs_sms_manage()} →
                    </a>
                )}
                <span className="text-[12px] text-ih-fg-4">{m.notif_prefs_sms_stop_hint()}</span>
            </div>
        </section>
    );
}
