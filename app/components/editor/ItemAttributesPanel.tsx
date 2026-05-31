import type { ItemAttribute } from '../../lib/types';

export interface ItemAttributesPanelProps {
    itemId: string;
    attributes: ItemAttribute[];
    values: Record<string, string | number | boolean | null>;
    onChange: (itemId: string, attributeId: string, value: string | number | boolean | null) => void;
}

export function ItemAttributesPanel({ itemId, attributes, values, onChange }: ItemAttributesPanelProps) {
    if (!attributes || attributes.length === 0) return null;
    return (
        <div className="mb-3 grid grid-cols-12 gap-2 text-[11px]">
            {attributes.map(attr => {
                const v = values[attr.id];
                const key = `${itemId}:${attr.id}`;
                if (attr.type === 'number') {
                    return (
                        <div key={key} className="col-span-6 md:col-span-3">
                            <label className="block font-bold uppercase tracking-[0.1em] text-slate-400 mb-0.5">
                                {attr.name}{attr.unit ? ` (${attr.unit})` : ''}
                            </label>
                            <input
                                type="number"
                                value={typeof v === 'number' ? v : ''}
                                onChange={e => onChange(itemId, attr.id, e.target.value === '' ? null : Number(e.target.value))}
                                className="w-full px-2 py-1 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
                            />
                        </div>
                    );
                }
                if (attr.type === 'select') {
                    return (
                        <div key={key} className="col-span-6 md:col-span-3">
                            <label className="block font-bold uppercase tracking-[0.1em] text-slate-400 mb-0.5">{attr.name}</label>
                            <select
                                value={typeof v === 'string' ? v : ''}
                                onChange={e => onChange(itemId, attr.id, e.target.value || null)}
                                className="w-full px-2 py-1 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
                            >
                                <option value="">—</option>
                                {(attr.choices ?? []).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    );
                }
                if (attr.type === 'boolean') {
                    return (
                        <div key={key} className="col-span-6 md:col-span-3 flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={v === true}
                                onChange={e => onChange(itemId, attr.id, e.target.checked)}
                                className="w-4 h-4 rounded border-ih-border-strong text-indigo-600 focus:ring-indigo-500/30"
                            />
                            <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">{attr.name}</label>
                        </div>
                    );
                }
                if (attr.type === 'date') {
                    return (
                        <div key={key} className="col-span-6 md:col-span-3">
                            <label className="block font-bold uppercase tracking-[0.1em] text-slate-400 mb-0.5">{attr.name}</label>
                            <input
                                type="date"
                                value={typeof v === 'string' ? v : ''}
                                onChange={e => onChange(itemId, attr.id, e.target.value || null)}
                                className="w-full px-2 py-1 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
                            />
                        </div>
                    );
                }
                // text / fallback (text + multi_select default to text input for v1)
                return (
                    <div key={key} className="col-span-6 md:col-span-3">
                        <label className="block font-bold uppercase tracking-[0.1em] text-slate-400 mb-0.5">{attr.name}</label>
                        <input
                            type="text"
                            value={typeof v === 'string' ? v : ''}
                            onChange={e => onChange(itemId, attr.id, e.target.value || null)}
                            className="w-full px-2 py-1 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
                        />
                    </div>
                );
            })}
        </div>
    );
}
