/**
 * Round-2 F3 — People card with role chips (Spectora §4.1 / §E.2).
 *
 * Renders the inspector + client + buyer's agent + listing agent for an
 * inspection as a single card. Each row carries:
 *
 *   - role chip (Buyer / Buyer's Agent / Listing Agent / Inspector)
 *   - name (avatar = initials)
 *   - email → mailto: link
 *   - phone → tel:   link
 *
 * Per-group counter ("Buyer's Agent · 2") is appended on the chip when the
 * group has multiple entries — schema today allows only 1, but the
 * component is forward-compatible.
 *
 * The card is driven by the Alpine state already loaded by the inspection
 * Settings page: `peopleCard.inspector`, `peopleCard.client`,
 * `peopleCard.buyerAgents`, `peopleCard.listingAgents`. The factory in
 * inspection-settings.js fetches /api/inspections/:id/people on init.
 */

const CHIP: Record<string, { label: string; bg: string; fg: string }> = {
    inspector:     { label: 'Inspector',     bg: '#eef2ff', fg: '#4338ca' },
    client:        { label: 'Buyer',         bg: '#f0fdf4', fg: '#166534' },
    agent_buyer:   { label: "Buyer's Agent", bg: '#ecfeff', fg: '#0e7490' },
    agent_listing: { label: 'Listing Agent', bg: '#fef3c7', fg: '#92400e' },
};

function chipStyle(kind: keyof typeof CHIP): string {
    const c = CHIP[kind]!;
    return `background: ${c.bg}; color: ${c.fg}`;
}

/**
 * One contact row inside the card. The kind drives the chip color/label.
 * The Alpine binding consumes a row object with `name`, `email`, `phone`.
 *
 * `bind` is the Alpine variable holding the row (e.g. `peopleCard.client`
 * for a single contact, or `a` inside a `<template x-for="a in ...">`
 * loop). `extraChip` (optional) renders an extra inline chip (e.g.
 * "Buyer's Agent · 2"). `wrapper` controls whether the row uses x-show
 * (single contact) or x-for (collection).
 */
interface PeopleRowProps {
    kind: keyof typeof CHIP;
    bind: string;
    show?: string;
    extraChipExpr?: string;
}

function initialsExpr(nameExpr: string): string {
    // Inline JS that returns at most 2 capitalised initials from a name.
    return `(${nameExpr} || '').trim().split(/\\s+/).slice(0,2).map(s => s.charAt(0).toUpperCase()).join('')`;
}

const PeopleRow = ({ kind, bind, show, extraChipExpr }: PeopleRowProps): JSX.Element => {
    const chip = CHIP[kind]!;
    const wrapperAttrs: Record<string, unknown> = show ? { 'x-show': show, style: 'display:none' } : {};
    return (
        <div class="flex items-center gap-3 py-2.5" data-test="people-card-row" {...wrapperAttrs}>
            <div
                class="w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold ring-1 ring-inset"
                style={`${chipStyle(kind)}; --tw-ring-color: ${chip.fg}33`}
                x-text={initialsExpr(`${bind}.name`)}
            ></div>
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-[14px] font-semibold text-slate-900 truncate" x-text={`${bind}.name`}></span>
                    <span
                        class="px-2 py-0.5 text-[10px] font-bold rounded-full whitespace-nowrap"
                        style={chipStyle(kind)}
                    >{chip.label}</span>
                    {extraChipExpr ? (
                        <span
                            class="px-2 py-0.5 text-[10px] font-bold rounded-full whitespace-nowrap bg-slate-100 text-slate-600"
                            x-text={extraChipExpr}
                        ></span>
                    ) : null}
                </div>
                <div class="text-[12px] mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <a
                        x-show={`${bind}.email`}
                        x-bind:href={`'mailto:' + ${bind}.email`}
                        class="text-indigo-600 hover:underline"
                        x-text={`${bind}.email`}
                    ></a>
                    <a
                        x-show={`${bind}.phone`}
                        x-bind:href={`'tel:' + ${bind}.phone`}
                        class="text-indigo-600 hover:underline"
                        x-text={`${bind}.phone`}
                    ></a>
                    <span x-show={`!${bind}.email && !${bind}.phone`} class="text-slate-400 italic">
                        No contact info
                    </span>
                </div>
            </div>
        </div>
    );
};

/**
 * The full card. Drop into a page that exposes a `peopleCard` Alpine
 * object via x-data. The card auto-hides when nothing is loaded.
 */
export const PeopleCard = (): JSX.Element => (
    <section
        class="bg-white border border-slate-200 rounded-md p-5"
        data-test="people-card"
        x-show="peopleCard"
        style="display:none"
    >
        <header class="flex items-center justify-between mb-3">
            <h2 class="text-[14px] font-bold tracking-tight text-slate-900">People</h2>
            <span class="text-[10px] font-mono text-slate-400" x-text="peopleCardCount + ' total'"></span>
        </header>
        <div class="divide-y divide-slate-100">
            <PeopleRow kind="inspector"   bind="peopleCard.inspector" show="peopleCard.inspector" />
            <PeopleRow kind="client"      bind="peopleCard.client"    show="peopleCard.client" />

            {/* Buyer's Agents — schema allows 1 today, but component handles N. */}
            <template x-for="(a, idx) in peopleCard.buyerAgents" {...{ 'x-bind:key': '"buyer-" + (a.id || idx)' }}>
                <PeopleRow
                    kind="agent_buyer"
                    bind="a"
                    extraChipExpr="peopleCard.buyerAgents.length > 1 ? ('· ' + (idx + 1) + '/' + peopleCard.buyerAgents.length) : ''"
                />
            </template>

            {/* Listing Agents */}
            <template x-for="(a, idx) in peopleCard.listingAgents" {...{ 'x-bind:key': '"listing-" + (a.id || idx)' }}>
                <PeopleRow
                    kind="agent_listing"
                    bind="a"
                    extraChipExpr="peopleCard.listingAgents.length > 1 ? ('· ' + (idx + 1) + '/' + peopleCard.listingAgents.length) : ''"
                />
            </template>

            <div
                x-show="peopleCardCount === 0"
                style="display:none"
                class="py-6 text-center text-[12px] text-slate-400"
            >
                No people linked to this inspection yet.
            </div>
        </div>
    </section>
);
