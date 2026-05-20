/**
 * Design System 0520 subsystem E phase 8 — TeamCredit + NACHI badge.
 *
 * Footer block on the customer-facing report page. Renders the team
 * that performed the inspection (lead + helpers + reviewers) plus,
 * when configured, the tenant's InterNACHI inspector ID. The NACHI
 * line doubles as proof-of-membership for buyers verifying their
 * inspector's credentials.
 *
 * Empty teams render an empty section header but no list rows; the
 * caller may decide to gate rendering on team.length > 0 instead.
 */
import type { FC } from 'hono/jsx';

export interface TeamCreditMember {
    name:        string;
    role:        string;
    reviewedBy?: string | null;
}

export const TeamCredit: FC<{
    team:  TeamCreditMember[];
    nachi?: string | null;
}> = ({ team, nachi }) => (
    <section class="border-t border-slate-200 mt-12 pt-6 pb-12 max-w-3xl mx-auto px-4">
        <h3 class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
            Inspected by
        </h3>
        <ul class="space-y-2 text-sm">
            {team.map(m => (
                <li class="flex items-center gap-3">
                    <div class="w-7 h-7 rounded-full bg-slate-300 flex items-center justify-center text-xs font-bold text-slate-700">
                        {(m.name || '?').slice(0, 2).toUpperCase()}
                    </div>
                    <span class="font-medium">{m.name}</span>
                    <span class="text-xs text-slate-500">
                        {m.role}
                        {m.reviewedBy ? ` · reviewed by ${m.reviewedBy}` : ''}
                    </span>
                </li>
            ))}
        </ul>

        {nachi && (
            <div class="mt-6 flex items-center gap-2 text-xs text-slate-500">
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 font-bold">
                    InterNACHI #<span class="font-mono">{nachi}</span>
                </span>
                <span>Signed with Ed25519 audit chain</span>
            </div>
        )}
    </section>
);
