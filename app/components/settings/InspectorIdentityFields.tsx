import {
    FL_1802_QUALIFICATION_CATEGORIES,
    FL_1802_QUALIFICATION_PROMPT,
} from "../../../server/lib/statutory/qualification-categories";
import { m } from "~/paraglide/messages";

/**
 * Who the inspector is, as it prints on a document they sign.
 *
 * ── WHY THESE FOUR ARE ONE GROUP ────────────────────────────────────────────
 * Name and phone are what a report footer carries; the state licence CLASS and
 * the statutory qualification are what an authority's form asks for in the same
 * breath, in the block beside the signature. They are answered together, once,
 * by the person they describe — and every one of them is printed rather than
 * used to look something up. The timezone and locale selects below them on the
 * page are a different kind of thing entirely: preferences that change what
 * THIS person sees and reach no document at all.
 *
 * ── 🔴 THE LICENCE CLASS IS NOT AN INSPECTOR CREDENTIAL ─────────────────────
 * The credentials editor on this page's "Licenses & affiliations" tab holds
 * association certifications — "InterNACHI CPI" and its member number. A
 * Citizens roof form prints the three licence classes it accepts (general,
 * residential, building or roofing contractor · building code inspector ·
 * Florida-licensed home inspector) and asks which one the signer holds.
 * Answering that box from an association certification prints something that
 * looks right and is wrong, which is the failure the whole statutory subsystem
 * exists to prevent. Both facts exist; neither answers for the other.
 *
 * The qualification beside it is a third axis again: FL OIR-B1-1802 prints its
 * own categories and asks the signer to declare which he qualifies under,
 * BESIDE his licence rather than instead of it.
 *
 * ── WHY IT LEFT THE ROUTE ───────────────────────────────────────────────────
 * `settings-profile.tsx` is one of the app's grandfathered large files and its
 * size ratchet is a standing argument against keeping anything there that can
 * stand on its own. This block can. The route keeps the form, the submit and
 * the intents; this keeps four inputs and the reason they belong together.
 *
 * ── CONFORM METADATA, STRUCTURALLY ──────────────────────────────────────────
 * `name` and `phone` are Conform-managed, so their id/name/errors are passed in
 * rather than re-derived. Typed structurally instead of importing Conform's
 * `FieldMetadata`: this component needs three properties of it and naming them
 * says so, where the imported type would suggest it uses the rest.
 *
 * The two statutory fields are plain named inputs with no Conform metadata,
 * exactly like the timezone and locale selects below: `parseWithZod` reads them
 * off the raw FormData. Nothing validates client-side because there is nothing
 * to validate — the vocabulary is the authority's, so the only server rule is a
 * length bound.
 *
 * ── 🔴 ONE OF THE TWO IS A LIST OF BOXES AND THE OTHER IS A LINE ────────────
 * The QUALIFICATION is six printed checkboxes with "(check one)" beside them,
 * so it is a radio group over the authority's own six categories
 * (`server/lib/statutory/qualification-categories.ts`). It used to be a text
 * box whose placeholder read "e.g. Building code inspector" — the form stores
 * `building_code_inspector`, so the field was teaching a value that could never
 * tick a box, and the inspector met the refusal after the fieldwork.
 *
 * The LICENCE CLASS beside it stays free text, and that is not an oversight:
 * the Citizens forms draw it as a line to write on, not as boxes, so there is
 * no closed vocabulary to offer. Converting it would invent one.
 */

/** The three properties of a Conform field this component actually reads. */
interface ConformFieldView {
    id: string;
    name: string;
    errors?: string[] | undefined;
}

export interface InspectorIdentityFieldsProps {
    nameField: ConformFieldView;
    phoneField: ConformFieldView;
    name: string | null;
    phone: string | null;
    /** State licence CLASS. Never an association certification — see above. */
    statutoryLicenseType: string | null;
    statutoryQualification: string | null;
}

const LABEL = "block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]";
const INPUT =
    "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary "
    + "focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] "
    + "placeholder:text-ih-fg-4 text-ih-fg-1";
const HINT = "text-[11px] text-ih-fg-3";
// `items-start`, not `items-center`: these labels are the authority's whole
// sentences and two of the six wrap, so a centred control floats mid-paragraph.
// That is also why shared-ui's `Radio` is not used here — it hardcodes
// `items-center` for one-line labels and offers no way past it.
const CHOICE = "flex items-start gap-2 cursor-pointer";
const RADIO = "accent-ih-primary h-4 w-4 mt-0.5 shrink-0";
const CHOICE_TEXT = "text-[13px] text-ih-fg-2 leading-relaxed";

/** The values a box exists for. Anything else means nothing is ticked. */
const declaredCategories = new Set(FL_1802_QUALIFICATION_CATEGORIES.map((c) => c.value));

export function InspectorIdentityFields({
    nameField,
    phoneField,
    name,
    phone,
    statutoryLicenseType,
    statutoryQualification,
}: InspectorIdentityFieldsProps) {
    return (
        <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="space-y-2">
                    <label htmlFor={nameField.id} className={LABEL}>{m.settings_profile_name_label()}</label>
                    <input
                        type="text"
                        id={nameField.id}
                        name={nameField.name}
                        defaultValue={name ?? ""}
                        placeholder={m.settings_profile_name_placeholder()}
                        aria-invalid={nameField.errors ? true : undefined}
                        className={INPUT}
                    />
                    {nameField.errors ? (
                        <p className="mt-1 text-xs text-ih-bad-fg">{nameField.errors[0]}</p>
                    ) : (
                        <p className={HINT}>{m.settings_profile_name_hint()}</p>
                    )}
                </div>
                <div className="space-y-2">
                    <label htmlFor={phoneField.id} className={LABEL}>{m.settings_profile_phone_label()}</label>
                    <input
                        type="tel"
                        id={phoneField.id}
                        name={phoneField.name}
                        defaultValue={phone ?? ""}
                        placeholder={m.settings_profile_phone_placeholder()}
                        aria-invalid={phoneField.errors ? true : undefined}
                        className={INPUT}
                    />
                    {phoneField.errors && (
                        <p className="mt-1 text-xs text-ih-bad-fg">{phoneField.errors[0]}</p>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                    <label htmlFor="statutoryLicenseType" className={LABEL}>
                        {m.settings_profile_statutory_licence_label()}
                    </label>
                    <input
                        type="text"
                        id="statutoryLicenseType"
                        name="statutoryLicenseType"
                        defaultValue={statutoryLicenseType ?? ""}
                        placeholder={m.settings_profile_statutory_licence_placeholder()}
                        className={INPUT}
                    />
                    <p className={HINT}>{m.settings_profile_statutory_licence_hint()}</p>
                </div>
            </div>

            <fieldset className="space-y-2">
                <legend className={LABEL}>
                    {m.settings_profile_statutory_qualification_label()}
                </legend>
                {/* The authority's own prompt, above the authority's own six
                    categories. Presenting the choice the way the page presents
                    it is what lets somebody recognise his line. */}
                <p className={HINT}>{FL_1802_QUALIFICATION_PROMPT}</p>
                <div className="space-y-1.5">
                    {/* Declaring nothing is a real answer: only one of the four
                        published forms asks, so most inspectors never fill this
                        in. It is FIRST and it is a radio like the rest, because
                        the alternative — no way back to empty once a box is
                        ticked — is how a wrong category becomes permanent. */}
                    <label className={CHOICE}>
                        <input
                            type="radio"
                            name="statutoryQualification"
                            value=""
                            defaultChecked={!declaredCategories.has(statutoryQualification ?? "")}
                            className={RADIO}
                        />
                        <span className={CHOICE_TEXT}>
                            {m.settings_profile_statutory_qualification_none()}
                        </span>
                    </label>
                    {FL_1802_QUALIFICATION_CATEGORIES.map((category) => (
                        <label key={category.value} className={CHOICE}>
                            <input
                                type="radio"
                                name="statutoryQualification"
                                value={category.value}
                                defaultChecked={statutoryQualification === category.value}
                                className={RADIO}
                            />
                            <span className={CHOICE_TEXT}>{category.printedAs}</span>
                        </label>
                    ))}
                </div>
                <p className={HINT}>{m.settings_profile_statutory_qualification_hint()}</p>
            </fieldset>
        </>
    );
}
