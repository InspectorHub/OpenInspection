import { useMemo } from 'react';
import {
    DEFECT_TRADE_OPTIONS, DEFECT_DEADLINE_OPTIONS, DEFECT_TIMEFRAME_OPTIONS,
    type DefectTrade, type DefectDeadline, type DefectTimeframe,
} from '../../lib/defect-fields';

export interface DefectFieldsValue {
    location?: string | null;
    trade?: DefectTrade | null;
    deadline?: DefectDeadline | null;
    timeframe?: DefectTimeframe | null;
}

export interface DefectFieldsRowProps {
    cannedId: string;
    value: DefectFieldsValue;
    /** Prior location strings used in this inspection — drives autocomplete via <datalist>. */
    locationSuggestions: string[];
    onChange: (cannedId: string, patch: Partial<DefectFieldsValue>) => void;
    /** Marks the location input as visually required when the publish gate flagged it. */
    locationRequired?: boolean;
    /** Marks the trade select as visually required when the publish gate flagged it. */
    tradeRequired?: boolean;
}

const DATALIST_ID = 'defect-location-suggestions';

export function DefectFieldsRow({
    cannedId, value, locationSuggestions, onChange, locationRequired, tradeRequired,
}: DefectFieldsRowProps) {
    const dedupedSuggestions = useMemo(
        () => Array.from(new Set(locationSuggestions.filter(s => s.length > 0))),
        [locationSuggestions],
    );

    return (
        <div className="mt-2 grid grid-cols-12 gap-2 text-[11px]" data-defect-id={cannedId}>
            {/* Location text */}
            <div className="col-span-12 md:col-span-5">
                <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">
                    Location {locationRequired && <span className="text-ih-bad-fg">*</span>}
                </label>
                <input
                    type="text"
                    list={DATALIST_ID}
                    value={value.location ?? ''}
                    onChange={e => onChange(cannedId, { location: e.target.value || null })}
                    placeholder="e.g. master bathroom, NE corner of basement"
                    className={`w-full px-2 py-1 rounded border bg-ih-bg-app text-ih-fg-1 ${
                        locationRequired && !value.location ? 'border-ih-bad' : 'border-ih-border'
                    }`}
                />
                <datalist id={DATALIST_ID}>
                    {dedupedSuggestions.map(s => <option key={s} value={s} />)}
                </datalist>
            </div>

            {/* Trade select */}
            <div className="col-span-12 md:col-span-3">
                <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">
                    Trade {tradeRequired && <span className="text-ih-bad-fg">*</span>}
                </label>
                <select
                    value={value.trade ?? ''}
                    onChange={e => onChange(cannedId, { trade: (e.target.value || null) as DefectTrade | null })}
                    className={`w-full px-2 py-1 rounded border bg-ih-bg-app text-ih-fg-1 ${
                        tradeRequired && !value.trade ? 'border-ih-bad' : 'border-ih-border'
                    }`}
                >
                    <option value="">— select —</option>
                    {DEFECT_TRADE_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            </div>

            {/* Deadline select */}
            <div className="col-span-6 md:col-span-2">
                <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">Deadline</label>
                <select
                    value={value.deadline ?? ''}
                    onChange={e => onChange(cannedId, { deadline: (e.target.value || null) as DefectDeadline | null })}
                    className="w-full px-2 py-1 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
                >
                    <option value="">—</option>
                    {DEFECT_DEADLINE_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            </div>

            {/* Timeframe select */}
            <div className="col-span-6 md:col-span-2">
                <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">Timeframe</label>
                <select
                    value={value.timeframe ?? ''}
                    onChange={e => onChange(cannedId, { timeframe: (e.target.value || null) as DefectTimeframe | null })}
                    className="w-full px-2 py-1 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
                >
                    <option value="">—</option>
                    {DEFECT_TIMEFRAME_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            </div>
        </div>
    );
}
