/**
 * One retention window: a heading, a years box, a Save, and the disclosure.
 *
 * There are two of these on the Compliance page — signed agreements and
 * rendered report PDFs — and they were briefly two near-identical components.
 * They are not the same question and their numbers come from different places,
 * but the CONTROL is the same control, and two copies is how one of them ends
 * up with the next fix and the other does not.
 *
 * What genuinely differs travels as props:
 *   - `min`, because zero is a real choice for report PDFs (indefinite
 *     retention, an explicit controller instruction the platform executes) and
 *     meaningless for agreements.
 *   - `intent` / `field`, the action branch and form key.
 *   - `note`, which belongs to its own number. The report-PDF one is a
 *     disclosure that seven years is a PLATFORM choice rather than a legal
 *     requirement, and it renders plainly here rather than behind a `<details>`
 *     or on a policy page: a disclosure the reader must open is one this
 *     program has already been told is insufficient.
 */
import { useState } from "react";
import { m } from "~/paraglide/messages";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";

export interface RetentionWindowSectionProps {
    heading: string;
    description: string;
    note: string;
    initialYears: number;
    min: number;
    max: number;
    /** The `_intent` this section's Save posts, and the action branch that reads it. */
    intent: string;
    /** The form field name the action reads the number back out of. */
    field: string;
}

interface ActionResult {
    ok: boolean;
    intent?: string;
    message?: string | undefined;
}

export function RetentionWindowSection({
    heading, description, note, initialYears, min, max, intent, field,
}: RetentionWindowSectionProps) {
    const { fetcher, submit, busy } = useGuardedSubmit<() => ActionResult>();
    const [years, setYears] = useState(String(initialYears));
    const [dirty, setDirty] = useState(false);

    const data = fetcher.data as ActionResult | undefined;
    // `intent` is compared, not just presence: both sections share one fetcher
    // shape, and without it saving either one would flash "Saved." on both.
    const settled = fetcher.state === "idle" && data?.intent === intent && !dirty;
    const saved = settled && data?.ok === true;
    const failed = settled && data?.ok === false;

    function handleSave() {
        setDirty(false);
        submit({ intent, [field]: years }, { method: "post" });
    }

    return (
        <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
            <div>
                <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">{heading}</h3>
                <p className="text-[12px] text-ih-fg-3 mt-1">{description}</p>
            </div>

            <div className="flex items-end gap-3 flex-wrap">
                <label className="block">
                    <span className="block text-[12px] font-bold text-ih-fg-2 mb-1">
                        {m.settings_compliance_years_label()}
                    </span>
                    <input
                        type="number"
                        min={min}
                        max={max}
                        step={1}
                        value={years}
                        onChange={(e) => { setYears(e.target.value); setDirty(true); }}
                        className="w-28 px-3 py-1.5 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                    />
                </label>
                <button
                    onClick={handleSave}
                    disabled={busy}
                    className="h-9 px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
                >
                    {busy ? m.settings_compliance_saving() : m.common_save()}
                </button>
                {saved && <span className="text-[13px] text-ih-ok-fg font-bold">{m.settings_flash_saved_short()}</span>}
                {failed && (
                    <span className="text-[13px] text-ih-bad-fg font-bold">
                        {data?.message ?? m.settings_compliance_save_failed()}
                    </span>
                )}
            </div>

            <p className="text-[12px] text-ih-fg-3 leading-relaxed">{note}</p>
        </section>
    );
}
