/**
 * The switch that makes the report-view legitimate-interests assessment hold.
 *
 * The assessment assigned the interest to the inspection company — a company
 * that could not enable this processing, could not disable it, and could not
 * see it happening. A legitimate interest may not be a mask for processing its
 * supposed beneficiary cannot decline, so the assessment did not hold until
 * this control existed (review review, B4).
 *
 * It is a checkbox rather than a toggle because the two retention windows
 * beside it are text inputs with a Save, and one control that commits on click
 * while its neighbours commit on Save is the kind of inconsistency a reader
 * resolves by guessing. Same shape, same button, same flash.
 *
 * The note renders plainly beneath, not behind a disclosure control: it says
 * what is recorded, what is not, that the number is a signal rather than proof,
 * and that a recipient can object. A reader deciding whether to enable
 * processing on someone else's behalf needs all four before they choose, not
 * after they click.
 */
import { useState } from "react";
import { m } from "~/paraglide/messages";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";

interface ActionResult {
    ok: boolean;
    intent?: string;
    message?: string | undefined;
}

export function ReportViewCountingSection({ initialEnabled }: { initialEnabled: boolean }) {
    const { fetcher, submit, busy } = useGuardedSubmit<() => ActionResult>();
    const [enabled, setEnabled] = useState(initialEnabled);
    const [dirty, setDirty] = useState(false);

    const data = fetcher.data as ActionResult | undefined;
    const settled = fetcher.state === "idle" && data?.intent === "view-counting-save" && !dirty;
    const saved = settled && data?.ok === true;
    const failed = settled && data?.ok === false;

    function handleSave() {
        setDirty(false);
        submit({ intent: "view-counting-save", enabled: enabled ? "1" : "0" }, { method: "post" });
    }

    return (
        <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
            <div>
                <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
                    {m.settings_compliance_views_heading()}
                </h3>
                <p className="text-[12px] text-ih-fg-3 mt-1">
                    {m.settings_compliance_views_desc()}
                </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => { setEnabled(e.target.checked); setDirty(true); }}
                        className="w-4 h-4 rounded border-ih-border text-ih-primary focus:shadow-ih-focus"
                    />
                    <span className="text-[13px] text-ih-fg-1">{m.settings_compliance_views_label()}</span>
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

            <p className="text-[12px] text-ih-fg-3 leading-relaxed">
                {m.settings_compliance_views_note()}
            </p>
        </section>
    );
}
