import { useId } from "react";

import { m } from "~/paraglide/messages";

/**
 * The two licensing facts a statutory form asks about the INSPECTOR.
 *
 * ── WHY THEY ARE NOT AN INSPECTOR CREDENTIAL ────────────────────────────────
 * The credentials editor further down this page holds association
 * certifications — "InterNACHI CPI" and its member number — and that is a
 * different fact from a STATE LICENCE CLASS. A Citizens roof form prints the
 * three classes it accepts (general/residential/building/roofing contractor ·
 * building code inspector · Florida-licensed home inspector) and asks which one
 * the signer holds; answering that box from an association certification prints
 * something that looks right and is wrong. Both facts exist, and neither
 * answers for the other.
 *
 * The qualification beside it is a third axis again: FL OIR-B1-1802 prints its
 * own categories and asks the signer to declare which one he qualifies under,
 * beside his licence rather than instead of it.
 *
 * ── WHY THEY LIVE ON THE PROFILE AND NOT ON AN INSPECTION ───────────────────
 * They are facts about the person, and they do not change between two houses
 * visited on one morning. Asking for them per inspection would be asking the
 * same question every day and giving two answers a chance to disagree.
 *
 * ── PLAIN NAMED INPUTS, NOT CONFORM FIELD METADATA ──────────────────────────
 * They ride the page's existing profile form and are read from raw FormData by
 * `parseWithZod`, exactly like the timezone and locale selects on the same
 * page. Nothing here validates client-side because there is nothing to
 * validate: the vocabulary is the authority's, so the only server rule is a
 * length bound.
 */
export function StatutoryLicenceFields({
    licenseType,
    qualification,
}: {
    licenseType: string | null;
    qualification: string | null;
}) {
    const ids = useId();
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
                <label
                    htmlFor={`${ids}-licence`}
                    className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]"
                >
                    {m.settings_profile_statutory_licence_label()}
                </label>
                <input
                    type="text"
                    id={`${ids}-licence`}
                    name="statutoryLicenseType"
                    defaultValue={licenseType ?? ""}
                    placeholder={m.settings_profile_statutory_licence_placeholder()}
                    className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-ih-fg-4 text-ih-fg-1"
                />
                <p className="text-[11px] text-ih-fg-3">{m.settings_profile_statutory_licence_hint()}</p>
            </div>
            <div className="space-y-2">
                <label
                    htmlFor={`${ids}-qualification`}
                    className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]"
                >
                    {m.settings_profile_statutory_qualification_label()}
                </label>
                <input
                    type="text"
                    id={`${ids}-qualification`}
                    name="statutoryQualification"
                    defaultValue={qualification ?? ""}
                    placeholder={m.settings_profile_statutory_qualification_placeholder()}
                    className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-ih-fg-4 text-ih-fg-1"
                />
                <p className="text-[11px] text-ih-fg-3">{m.settings_profile_statutory_qualification_hint()}</p>
            </div>
        </div>
    );
}
