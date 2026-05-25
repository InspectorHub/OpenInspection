import { SettingsLayout } from '../components/settings-layout';
import type { BrandingConfig } from '../../types/auth';

/**
 * Agent Accounts A3 — Settings → Catalog → Booking concierge toggle page.
 *
 * Frontend-design directive (non-negotiable per plan): include a tiny inline
 * 2-box flow diagram for each mode so single-toggle settings without context
 * don't cause regret-clicks.
 *
 * Off (default): Agent submits -> Client confirms          (HomeGauge auto mode)
 * On:           Agent submits -> You review -> Client confirms  (Spectora reviewer mode)
 */
export interface SettingsCatalogBookingPageProps {
    branding?: BrandingConfig | undefined;
    tenantConfig: { conciergeReviewRequired: boolean };
}

export const SettingsCatalogBookingPage = ({
    branding,
    tenantConfig,
}: SettingsCatalogBookingPageProps): JSX.Element => {
    const reviewOn = !!tenantConfig.conciergeReviewRequired;
    return (
        <SettingsLayout
            branding={branding}
            title="Settings | Booking"
            group="catalog"
            subPage="booking"
            pageTitle="Booking"
            pageSubtitle="How agents create bookings on behalf of clients."
        >
            <section class="bg-white border border-surface-200 rounded-lg p-6 space-y-5">
                <header>
                    <h3 class="text-base font-bold text-ink-900">Concierge bookings</h3>
                    <p class="text-sm text-ink-600 mt-1 leading-relaxed">
                        Partner agents can submit bookings on behalf of their clients. By default
                        the client gets a magic-link to confirm immediately. Turn on review mode if
                        you want to approve each draft before the client is notified.
                    </p>
                </header>

                {/* 2-box flow diagram — non-negotiable per frontend-design directive.
                    Renders both modes side-by-side; the active mode highlights with
                    the brand color so the agent sees current behavior at a glance. */}
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="concierge-flow-diagram">
                    <div
                        class={`border rounded-lg p-4 ${reviewOn ? 'border-surface-200 bg-surface-50' : 'border-blueprint-300 bg-blueprint-50/40'}`}
                        aria-current={reviewOn ? undefined : 'true'}
                    >
                        <div class="text-[10px] font-bold uppercase tracking-widest text-ink-500 mb-2">
                            Auto mode (default){!reviewOn ? ' — active' : ''}
                        </div>
                        <div class="flex items-center gap-2 text-xs font-semibold text-ink-800">
                            <span class="px-2 py-1 rounded border border-surface-200 bg-white">Agent submits</span>
                            <span class="text-ink-400">&rarr;</span>
                            <span class="px-2 py-1 rounded border border-surface-200 bg-white">Client confirms</span>
                        </div>
                        <p class="text-xs text-ink-500 mt-2 leading-relaxed">
                            Magic link goes to the client immediately.
                        </p>
                    </div>
                    <div
                        class={`border rounded-lg p-4 ${reviewOn ? 'border-blueprint-300 bg-blueprint-50/40' : 'border-surface-200 bg-surface-50'}`}
                        aria-current={reviewOn ? 'true' : undefined}
                    >
                        <div class="text-[10px] font-bold uppercase tracking-widest text-ink-500 mb-2">
                            Review mode{reviewOn ? ' — active' : ''}
                        </div>
                        <div class="flex items-center gap-2 text-xs font-semibold text-ink-800">
                            <span class="px-2 py-1 rounded border border-surface-200 bg-white">Agent submits</span>
                            <span class="text-ink-400">&rarr;</span>
                            <span class="px-2 py-1 rounded border border-blueprint-300 bg-blueprint-50">You review</span>
                            <span class="text-ink-400">&rarr;</span>
                            <span class="px-2 py-1 rounded border border-surface-200 bg-white">Client confirms</span>
                        </div>
                        <p class="text-xs text-ink-500 mt-2 leading-relaxed">
                            You approve each draft before the client is notified.
                        </p>
                    </div>
                </div>

                <form id="conciergeToggleForm" class="flex items-center justify-between gap-4 pt-3 border-t border-surface-200" autocomplete="off">
                    <label class="flex items-start gap-3 flex-1 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            name="conciergeReviewRequired"
                            data-testid="concierge-review-toggle"
                            class="mt-1 h-4 w-4 rounded border-surface-300 text-blueprint-600 focus:ring-blueprint-500"
                            checked={reviewOn}
                        />
                        <span>
                            <span class="block text-sm font-semibold text-ink-900">
                                Review concierge bookings before sending to client
                            </span>
                            <span class="block text-xs text-ink-500 mt-0.5 leading-relaxed">
                                When enabled, you must approve each booking from your dashboard
                                before the client receives the magic link.
                            </span>
                        </span>
                    </label>
                    <button
                        type="submit"
                        class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all flex-shrink-0"
                    >
                        Save
                    </button>
                </form>

                <div id="conciergeToggleErr" class="text-sm text-rose-600" style="display:none;"></div>
                <div id="conciergeToggleOk" class="text-sm text-emerald-600" style="display:none;">Saved.</div>
            </section>

            <script dangerouslySetInnerHTML={{ __html: `
                (function() {
                    var form = document.getElementById('conciergeToggleForm');
                    if (!form) return;
                    var err = document.getElementById('conciergeToggleErr');
                    var ok  = document.getElementById('conciergeToggleOk');
                    form.addEventListener('submit', function(ev) {
                        ev.preventDefault();
                        err.style.display = 'none';
                        ok.style.display  = 'none';
                        var fd = new FormData(form);
                        var enabled = !!fd.get('conciergeReviewRequired');
                        fetch('/api/admin/tenant-config', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'same-origin',
                            body: JSON.stringify({ conciergeReviewRequired: enabled })
                        }).then(function(r) {
                            if (r.ok) {
                                ok.style.display = 'block';
                                setTimeout(function() { window.location.reload(); }, 600);
                            } else {
                                err.textContent = 'Save failed (' + r.status + ').';
                                err.style.display = 'block';
                            }
                        }).catch(function() {
                            err.textContent = 'Network error.';
                            err.style.display = 'block';
                        });
                    });
                })();
            `}} />
        </SettingsLayout>
    );
};
