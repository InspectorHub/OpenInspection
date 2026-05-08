/**
 * Round-2 backlog G1 (Spectora §E.2 / §4.1) — Property Facts strip.
 *
 * Six inline-editable property attributes shown on the inspection settings
 * page and (read-only) at the top of the published report:
 *
 *   Year Built · SqFt · Foundation · Lot Size · Bedrooms · Bathrooms
 *
 * Card variant — driven by Alpine state declared in inspection-settings.js
 * (`facts.*`, `factsState`, `saveFact`). Each cell is a single input that
 * persists on `change` via PATCH /api/inspections/:id/property-facts.
 *
 * Banner variant — server-rendered from `getReportData`'s `propertyFacts`
 * payload. No Alpine; just a static row of label / value pairs.
 */

const FOUNDATION_OPTIONS: Array<{ value: string; label: string }> = [
    { value: '',            label: '—' },
    { value: 'basement',    label: 'Basement' },
    { value: 'slab',        label: 'Slab' },
    { value: 'crawlspace',  label: 'Crawlspace' },
    { value: 'other',       label: 'Other' },
];

/**
 * Editable card placed in inspection/settings.tsx. Each input binds to the
 * `facts` Alpine reactive object and saves on change via the
 * /api/inspections/:id/property-facts endpoint.
 */
export const PropertyFactsCard = (): JSX.Element => (
    <fieldset
        class="space-y-4"
        data-testid="property-facts-card"
    >
        <legend class="text-[16px] font-semibold tracking-tight text-slate-900">Property facts</legend>
        <p class="text-[12px] text-slate-500">
            Surfaced as a banner on the published report. Leave blank for fields you didn't capture —
            the report renders only the facts you fill in.
        </p>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Year Built */}
            <label class="block">
                <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Year Built</span>
                <input
                    type="number"
                    min="1800"
                    max="2100"
                    step="1"
                    placeholder="—"
                    data-testid="property-facts-year-built"
                    {...{ 'x-model.number': 'facts.yearBuilt' }}
                    {...{ 'x-on:change': "saveFact('yearBuilt', $event.target.value)" }}
                    class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 text-[14px] font-medium tabular-nums focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none placeholder:text-slate-300"
                />
            </label>

            {/* SqFt */}
            <label class="block">
                <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">SqFt</span>
                <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="—"
                    data-testid="property-facts-sqft"
                    {...{ 'x-model.number': 'facts.sqft' }}
                    {...{ 'x-on:change': "saveFact('sqft', $event.target.value)" }}
                    class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 text-[14px] font-medium tabular-nums focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none placeholder:text-slate-300"
                />
            </label>

            {/* Foundation Type */}
            <label class="block">
                <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Foundation Type</span>
                <select
                    data-testid="property-facts-foundation"
                    x-model="facts.foundationType"
                    {...{ 'x-on:change': "saveFact('foundationType', $event.target.value)" }}
                    class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                >
                    {FOUNDATION_OPTIONS.map(o => (
                        <option value={o.value}>{o.label}</option>
                    ))}
                </select>
            </label>

            {/* Lot Size — free text ("0.25 acres") */}
            <label class="block">
                <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Lot Size</span>
                <input
                    type="text"
                    maxLength={50}
                    placeholder="—"
                    data-testid="property-facts-lot-size"
                    x-model="facts.lotSize"
                    {...{ 'x-on:change': "saveFact('lotSize', $event.target.value)" }}
                    class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none placeholder:text-slate-300"
                />
            </label>

            {/* Bedrooms */}
            <label class="block">
                <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Bedrooms</span>
                <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="—"
                    data-testid="property-facts-bedrooms"
                    {...{ 'x-model.number': 'facts.bedrooms' }}
                    {...{ 'x-on:change': "saveFact('bedrooms', $event.target.value)" }}
                    class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 text-[14px] font-medium tabular-nums focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none placeholder:text-slate-300"
                />
            </label>

            {/* Bathrooms */}
            <label class="block">
                <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Bathrooms</span>
                <input
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder="—"
                    data-testid="property-facts-bathrooms"
                    {...{ 'x-model.number': 'facts.bathrooms' }}
                    {...{ 'x-on:change': "saveFact('bathrooms', $event.target.value)" }}
                    class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 text-[14px] font-medium tabular-nums focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none placeholder:text-slate-300"
                />
            </label>
        </div>

        <div class="text-[12px] text-slate-500" aria-live="polite">
            <span x-show="factsState === 'saving'" style="display:none" class="text-amber-600 font-bold">Saving…</span>
            <span x-show="factsState === 'saved'"  style="display:none" class="text-emerald-600 font-bold">Saved</span>
            <span x-show="factsState === 'error'"  style="display:none" class="text-rose-600 font-bold">Couldn't save — try again</span>
        </div>
    </fieldset>
);

/**
 * Read-only banner rendered above the published report (Spectora §E.2).
 * Renders nothing when no facts are populated.
 */
export interface PropertyFactsBannerProps {
    facts: {
        yearBuilt:      number | null;
        sqft:           number | null;
        foundationType: string | null;
        lotSize:        string | null;
        bedrooms:       number | null;
        bathrooms:      number | null;
    };
}

const FOUNDATION_LABELS: Record<string, string> = {
    basement:   'Basement',
    slab:       'Slab',
    crawlspace: 'Crawlspace',
    other:      'Other',
};

function formatBathrooms(n: number): string {
    // Match Spectora's "2.5 / 2.0 / 3" — drop trailing zeroes; integer baths
    // render without decimals.
    const trimmed = Number(n.toFixed(2));
    return Number.isInteger(trimmed) ? String(trimmed) : trimmed.toFixed(1);
}

function formatSqft(n: number): string {
    return new Intl.NumberFormat('en-US').format(n);
}

export const PropertyFactsBanner = ({ facts }: PropertyFactsBannerProps): JSX.Element | null => {
    const cells: Array<{ label: string; value: string }> = [];
    if (facts.yearBuilt != null)       cells.push({ label: 'Year Built',  value: String(facts.yearBuilt) });
    if (facts.sqft      != null)       cells.push({ label: 'Sq Ft',       value: formatSqft(facts.sqft) });
    if (facts.foundationType)          cells.push({ label: 'Foundation',  value: FOUNDATION_LABELS[facts.foundationType] ?? facts.foundationType });
    if (facts.lotSize && facts.lotSize.trim() !== '')
                                       cells.push({ label: 'Lot Size',    value: facts.lotSize });
    if (facts.bedrooms  != null)       cells.push({ label: 'Bedrooms',    value: String(facts.bedrooms) });
    if (facts.bathrooms != null)       cells.push({ label: 'Bathrooms',   value: formatBathrooms(facts.bathrooms) });

    if (cells.length === 0) return null;

    return (
        <section
            data-testid="report-property-facts-banner"
            class="max-w-4xl mx-auto px-4 sm:px-6 mb-6"
            aria-label="Property facts"
        >
            <div class="theme-card grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 px-4 py-3">
                {cells.map(c => (
                    <div class="text-center sm:text-left">
                        <div class="text-[10px] font-bold uppercase tracking-[0.18em] theme-text-muted">{c.label}</div>
                        <div class="text-sm font-semibold theme-font-display tabular-nums">{c.value}</div>
                    </div>
                ))}
            </div>
        </section>
    );
};
