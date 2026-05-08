/**
 * Round-2 backlog #2 — Reusable inspection list row (Spectora §5.1 / §E.7).
 *
 * Single source of truth for the inspection row markup used inside every
 * dashboard bucket section (Needs Attention, Today, This Week, Later, Recent
 * Reports, Cancelled). Used to be duplicated six times in dashboard.tsx —
 * now lives here so the Customize Columns logic is wired in one place.
 *
 * The row is rendered inside an Alpine `<template x-for="i in buckets.xxx">`
 * loop, so every column's visibility binds to the `dashboard()` factory's
 * `isVisible(id)` reactive helper. The factory is in dashboard.js. The
 * registry of column ids lives in src/lib/dashboard-columns.ts.
 *
 * The property address column is always rendered — it carries the link to
 * the inspection edit page. Hiding it would orphan the row.
 */

import { RowStatusIcons } from './row-status-icons';

/**
 * One inspection row. Pure JSX (no script). Every column is wrapped in
 * `x-show="isVisible('id')"` so toggling columns in the modal hides/shows
 * the matching DOM nodes without re-rendering the whole list.
 */
export const InspectionRow = (): JSX.Element => (
    <div class="px-5 py-3 border-t border-slate-100 flex items-center gap-3 flex-wrap sm:flex-nowrap" data-test="inspection-row">
        {/* Property address — always rendered. Click target for the row. */}
        <a x-bind:href="'/inspections/' + i.id + '/edit'" class="flex-1 min-w-0">
            <p
                class="font-bold text-slate-900 truncate text-[14px]"
                x-text="i.propertyAddress || i.address || '(no address)'"
                data-column="propertyAddress"
            ></p>
            <p class="text-[12px] text-slate-500 mt-0.5">
                {/* Client name */}
                <span x-show="isVisible('clientName')" data-column="clientName">
                    <span x-text="i.clientName || '—'"></span>
                </span>
                {/* Agent (listing or buyer's agent) */}
                <template x-if="isVisible('agent') && i.agentName">
                    <span data-column="agent"> · <span class="text-slate-400">via</span> <span x-text="i.agentName"></span></span>
                </template>
                {/* Sprint 2 S2-2 — sibling-count badge for multi-inspection requests. */}
                <template x-if="i.siblingCount && i.siblingCount > 1">
                    <span> · <span class="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold ring-1 ring-inset ring-indigo-200" x-text="i.siblingCount + ' inspections'"></span></span>
                </template>
                {/* Inspection date */}
                <span x-show="isVisible('date')" data-column="date">
                    <span> · </span>
                    <span x-text="i.date ? new Date(i.date).toLocaleString() : 'no date'"></span>
                </span>
                {/* Inspector (assigned user) */}
                <template x-if="isVisible('inspector') && i.inspectorName">
                    <span data-column="inspector"> · <span class="text-slate-400">by</span> <span x-text="i.inspectorName"></span></span>
                </template>
                {/* Closing date — competitive parity G2 (Spectora §E.2) */}
                <template x-if="isVisible('closingDate') && i.closingDate">
                    <span data-column="closingDate"> · <span class="text-slate-400">closes</span> <span x-text="new Date(i.closingDate).toLocaleDateString()"></span></span>
                </template>
                {/* Order ID — competitive parity G3 (Spectora §4.1) */}
                <template x-if="isVisible('orderId') && i.orderId">
                    <span data-column="orderId"> · <span class="text-slate-400">#</span><span class="font-mono" x-text="i.orderId"></span></span>
                </template>
                {/* Referral source — competitive parity G3 */}
                <template x-if="isVisible('referralSource') && i.referralSource">
                    <span data-column="referralSource"> · <span class="text-slate-400">via</span> <span x-text="i.referralSource"></span></span>
                </template>
                {/* Property facts — yearBuilt / sqft toggled together */}
                <template x-if="isVisible('propertyFacts') && (i.yearBuilt || i.sqft)">
                    <span data-column="propertyFacts" class="text-slate-400">
                        <template x-if="i.yearBuilt">
                            <span> · YB <span x-text="i.yearBuilt"></span></span>
                        </template>
                        <template x-if="i.sqft">
                            <span> · <span x-text="i.sqft"></span> sqft</span>
                        </template>
                    </span>
                </template>
            </p>
            {/* Defect chips — Spec 5B P2B. Hidden when all zero or column off. */}
            <div
                class="mt-1 flex items-center gap-1.5"
                data-column="defectChips"
                x-show="isVisible('defectChips') && i.defectStats && (i.defectStats.safety + i.defectStats.recommendation + i.defectStats.maintenance) > 0"
            >
                <span x-show="i.defectStats?.safety > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-50 text-rose-700" x-text="'🔴 ' + i.defectStats.safety + ' safety'"></span>
                <span x-show="i.defectStats?.recommendation > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-50 text-amber-700" x-text="'🟡 ' + i.defectStats.recommendation + ' rec'"></span>
                <span x-show="i.defectStats?.maintenance > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-sky-50 text-sky-700" x-text="'🔵 ' + i.defectStats.maintenance + ' maint'"></span>
            </div>
        </a>
        {/* Price / Invoice status — right-aligned, monospace */}
        <div
            x-show="isVisible('price') && i.price > 0"
            data-column="price"
            class="text-[13px] font-mono font-semibold text-slate-700 tabular-nums"
            x-text="'$' + ((i.price || 0) / 100).toFixed(0)"
        ></div>
        {/* Status icons — Round-2 F2 (📄 ready · 📋 signed · ✈️ sent · 🚩 flag) */}
        <div x-show="isVisible('statusIcons')" data-column="statusIcons">
            <RowStatusIcons />
        </div>
        {/* Action menu — always rendered (not part of the customizable column set). */}
        <div x-data="actionMenu({ id: i.id, status: i.status })" class="relative ml-3">
            <button type="button" x-on:click="open = !open" class="text-slate-400 hover:text-slate-700 px-2 text-lg font-bold">•••</button>
            <div x-show="open" {...{ 'x-cloak': true, 'x-on:click.outside': 'open = false' }} class="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 min-w-[140px]">
                <template x-for="a in validActions()" {...{ 'x-bind:key': 'a' }}>
                    <button type="button" x-on:click="run(a)" class="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50" x-text="actionLabel(a)"></button>
                </template>
            </div>
        </div>
    </div>
);
