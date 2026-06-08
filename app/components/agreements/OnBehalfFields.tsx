import { useId } from "react";

/**
 * Track I-a §5.2 — shared "signing on behalf of someone else" capture, used by
 * BOTH the standalone agreement-sign page and the combined checkout page.
 *
 * A checkbox reveals an agent-name input + an authorized-agent disclaimer. The
 * two values map 1:1 to the public sign endpoint's optional `onBehalfOf`
 * (max 200) / `onBehalfDisclaimer` (max 2000) fields.
 *
 * Fully controlled — the parent owns state so it can include the values in its
 * submit payload. Light-only (no dark variants), DS tokens only.
 */
export interface OnBehalfValue {
    enabled: boolean;
    onBehalfOf: string;
    onBehalfDisclaimer: string;
}

export const EMPTY_ON_BEHALF: OnBehalfValue = {
    enabled: false,
    onBehalfOf: "",
    onBehalfDisclaimer: "",
};

export function OnBehalfFields({
    value,
    onChange,
    disabled,
}: {
    value: OnBehalfValue;
    onChange: (next: OnBehalfValue) => void;
    disabled?: boolean;
}) {
    const checkboxId = useId();
    const nameId = useId();
    const disclaimerId = useId();

    return (
        <div className="mt-4">
            <label htmlFor={checkboxId} className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                    id={checkboxId}
                    type="checkbox"
                    checked={value.enabled}
                    disabled={disabled}
                    onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary focus:ring-ih-primary/30"
                />
                <span className="text-[13px] font-medium text-ih-fg-2 leading-snug">
                    I am signing on behalf of someone else
                </span>
            </label>

            {value.enabled && (
                <div className="mt-3 pl-6 space-y-3">
                    <div>
                        <label htmlFor={nameId} className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">
                            Name of the person you represent
                        </label>
                        <input
                            id={nameId}
                            type="text"
                            value={value.onBehalfOf}
                            disabled={disabled}
                            maxLength={200}
                            onChange={(e) => onChange({ ...value, onBehalfOf: e.target.value })}
                            placeholder="e.g. Jane Buyer"
                            className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1 focus:ring-2 focus:ring-ih-primary/30 outline-none"
                        />
                    </div>
                    <div>
                        <label htmlFor={disclaimerId} className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">
                            Authorization (optional)
                        </label>
                        <textarea
                            id={disclaimerId}
                            value={value.onBehalfDisclaimer}
                            disabled={disabled}
                            rows={3}
                            maxLength={2000}
                            onChange={(e) => onChange({ ...value, onBehalfDisclaimer: e.target.value })}
                            placeholder="Describe your authority to sign for this person."
                            className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1 focus:ring-2 focus:ring-ih-primary/30 outline-none"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Maps the controlled value to the optional fields the public sign endpoint
 * accepts. Returns an empty object when the toggle is off so we never post
 * empty strings.
 */
export function onBehalfPayload(value: OnBehalfValue): { onBehalfOf?: string; onBehalfDisclaimer?: string } {
    if (!value.enabled) return {};
    const out: { onBehalfOf?: string; onBehalfDisclaimer?: string } = {};
    const name = value.onBehalfOf.trim();
    const disclaimer = value.onBehalfDisclaimer.trim();
    if (name) out.onBehalfOf = name;
    if (disclaimer) out.onBehalfDisclaimer = disclaimer;
    return out;
}
