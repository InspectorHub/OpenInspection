/**
 * Round-2 F2 — Inspection list status-icon column.
 *
 * Compact row of 4 status indicators rendered in the dashboard / inspections
 * list. Each icon is 14px, grayed when its state is `false`, semantic-colored
 * when `true`, and carries a tooltip via `title`.
 *
 * Driven by `i.statusFlags` (from InspectionService.getDashboardBuckets):
 *   - 📄 reportReady     — report is built (status `completed` or `delivered`)
 *   - 📋 agreementSigned — at least one signed agreement
 *   - ✈️ sent           — publish workflow finished (status `delivered`)
 *   - 🚩 flagged         — sits in Needs Attention bucket
 *
 * The component is JSX-only (no script) so it inlines cleanly inside the
 * Alpine `<template x-for>` row loops in dashboard.tsx. The shape was
 * intentionally kept identical to the previous inline block to minimise
 * visual churn.
 */
export const RowStatusIcons = (): JSX.Element => (
    <div class="flex items-center gap-1 text-slate-300" data-test="row-status-icons">
        {/* 📄 Report ready — completed or delivered */}
        <span
            class="w-5 h-5 inline-flex items-center justify-center"
            x-bind:class="i.statusFlags?.reportReady ? 'text-emerald-500' : ''"
            x-bind:title="i.statusFlags?.reportReady ? 'Report ready' : 'Report not yet ready'"
            x-bind:aria-label="i.statusFlags?.reportReady ? 'Report ready' : 'Report not yet ready'"
        >
            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                <path
                    fill-rule="evenodd"
                    d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z"
                    clip-rule="evenodd"
                />
            </svg>
        </span>
        {/* 📋 Agreement signed */}
        <span
            class="w-5 h-5 inline-flex items-center justify-center"
            x-bind:class="i.statusFlags?.agreementSigned ? 'text-emerald-500' : ''"
            x-bind:title="i.statusFlags?.agreementSigned ? 'Agreement signed' : 'Agreement not yet signed'"
            x-bind:aria-label="i.statusFlags?.agreementSigned ? 'Agreement signed' : 'Agreement not yet signed'"
        >
            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path
                    fill-rule="evenodd"
                    d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clip-rule="evenodd"
                />
            </svg>
        </span>
        {/* ✈️ Sent — publish completed (delivered) */}
        <span
            class="w-5 h-5 inline-flex items-center justify-center"
            x-bind:class="i.statusFlags?.sent ? 'text-sky-500' : ''"
            x-bind:title="i.statusFlags?.sent ? 'Report sent' : 'Report not yet sent'"
            x-bind:aria-label="i.statusFlags?.sent ? 'Report sent' : 'Report not yet sent'"
        >
            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
        </span>
        {/* 🚩 Flagged — Needs Attention bucket */}
        <span
            x-show="i.statusFlags?.flagged"
            class="w-5 h-5 inline-flex items-center justify-center text-rose-500"
            title="Flagged: invoice overdue or other attention needed"
            aria-label="Flagged"
        >
            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path
                    fill-rule="evenodd"
                    d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z"
                    clip-rule="evenodd"
                />
            </svg>
        </span>
    </div>
);
