/**
 * Design System 0520 subsystem E P4.3 — IdentitySwitcher dropdown.
 *
 * Renders inside the user menu. Hidden via x-show when the caller
 * has no linked identities (the common case for solo inspectors).
 * Clicking a row POSTs to /api/identities/switch which sets a new
 * session cookie and returns a redirect URL the factory navigates to.
 */
import type { FC } from 'hono/jsx';

export const IdentitySwitcher: FC = () => (
    <div
        x-data="identitySwitcher()"
        {...{ 'x-init': 'init()' }}
        x-show="identities.length > 0"
        style="display: none"
        class="border-t border-slate-100 pt-2 mt-2"
    >
        <div class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1 px-3">
            Switch identity
        </div>
        <template {...{ 'x-for': 'id in identities', ':key': 'id.id' }}>
            <button class="w-full text-left px-3 py-2 hover:bg-slate-100 flex items-center gap-2"
                    {...{ '@click': 'switchTo(id.linkedUserId)', ':disabled': 'submitting' }}>
                <div class="w-7 h-7 rounded-full bg-slate-300 flex items-center justify-center text-xs font-bold text-slate-700"
                     {...{ 'x-text': '(id.linkedDisplayName || "?").slice(0, 2).toUpperCase()' }} />
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium truncate" x-text="id.linkedDisplayName" />
                    <div class="text-xs text-slate-500" x-text="id.linkedRole" />
                </div>
            </button>
        </template>
        <p class="text-[11px] text-rose-600 px-3" x-show="error" x-text="error" />
    </div>
);
