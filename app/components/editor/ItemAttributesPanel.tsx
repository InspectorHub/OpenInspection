import type { ItemAttribute } from '../../lib/types';

/**
 * What one attribute can hold.
 *
 * The array is a `multi_select`, and it is here because a statutory form asks
 * for one: six published questions print "check all that apply" — the Citizens
 * photo requirements (6 boxes), electrical hazards (13), wiring types (8), pipe
 * types (8), roof damage signs (8 in each of two columns) and the 1802's roof
 * coverings (7). The renderer has always marked every box a list names; until
 * this type widened there was no control that could produce one.
 */
export type ItemAttributeValue = string | number | boolean | string[] | null;

export interface ItemAttributesPanelProps {
    itemId: string;
    attributes: ItemAttribute[];
    values: Record<string, ItemAttributeValue>;
    onChange: (itemId: string, attributeId: string, value: ItemAttributeValue) => void;
}

/** What is already ticked, tolerating the scalar a `select` used to store. */
function chosen(value: ItemAttributeValue): string[] {
    if (Array.isArray(value)) return value;
    return typeof value === 'string' && value !== '' ? [value] : [];
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
                            <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">
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
                            <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{attr.name}</label>
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
                                className="w-4 h-4 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30"
                            />
                            <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-ih-fg-3">{attr.name}</label>
                        </div>
                    );
                }
                if (attr.type === 'date') {
                    return (
                        <div key={key} className="col-span-6 md:col-span-3">
                            <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{attr.name}</label>
                            <input
                                type="date"
                                value={typeof v === 'string' ? v : ''}
                                onChange={e => onChange(itemId, attr.id, e.target.value || null)}
                                className="w-full px-2 py-1 rounded border border-ih-border bg-ih-bg-app text-ih-fg-1"
                            />
                        </div>
                    );
                }
                if (attr.type === 'multi_select') {
                    const ticked = chosen(v);
                    return (
                        // Wider than the other controls: this is a column of
                        // boxes rather than one field, and squeezed into a
                        // quarter width every option wraps onto two lines.
                        <fieldset key={key} className="col-span-12 md:col-span-6">
                            <legend className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">
                                {attr.name}
                            </legend>
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                                {(attr.choices ?? []).map(c => (
                                    <label key={c} className="flex items-center gap-1.5 text-ih-fg-2">
                                        <input
                                            type="checkbox"
                                            checked={ticked.includes(c)}
                                            onChange={e => {
                                                // Rebuilt from the DECLARED choice
                                                // order, never by appending: the
                                                // stored value is what a form's
                                                // `whenValue` is matched against,
                                                // and a list whose order depends on
                                                // the order somebody clicked is a
                                                // value that differs between two
                                                // inspectors who answered the same.
                                                const next = (attr.choices ?? []).filter(
                                                    (option) => (option === c
                                                        ? e.target.checked
                                                        : ticked.includes(option)),
                                                );
                                                // Empty is NOT an empty array. A form
                                                // reader refuses one by name: "none
                                                // of these" is the empty string, and
                                                // an empty list is what a binding
                                                // that resolved nothing produces.
                                                onChange(itemId, attr.id, next.length > 0 ? next : null);
                                            }}
                                            className="w-3.5 h-3.5 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30"
                                        />
                                        {c}
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    );
                }
                // text / fallback
                return (
                    <div key={key} className="col-span-6 md:col-span-3">
                        <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">{attr.name}</label>
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
