import { BareLayout } from '../layouts/main-layout';
import { AddressAutocomplete } from '../components/address-autocomplete';
import { BrandingConfig } from '../../types/auth';

interface PublicBookingPageProps {
    siteKey: string;
    branding?: BrandingConfig | undefined;
    embed?: boolean;
    style?: 'light' | 'dark' | 'branded';
}

/**
 * Sprint 1 Sub-spec C — public booking page.
 *
 * Customer-facing fixes shipped here:
 *   * C-1 — date input is plain text + JS mask + locale-stable English
 *           placeholder. The native <input type="date"> placeholder leaks
 *           OS locale on Chinese / Japanese systems ("年/月/日"); replacing
 *           it removes the leak.
 *   * C-4 — section headers use plain English ("Property" / "Your info" /
 *           "Schedule"), no "PHASE I/II/III" jargon.
 *   * C-5 — site address uses the AddressAutocomplete component (Google
 *           Places proxy via /api/public/geocode). Falls back to plain
 *           text when no API key is configured.
 *   * C-6 — time window is a 4-option radio card grid (Morning /
 *           Afternoon / All day / Custom) plus an inline time picker
 *           that shows when "Custom" is selected.
 *
 * Tone is calm-authority: short subtitle under each section, single
 * primary CTA, no atmospheric blob, no glass-panel new uses, no
 * font-black anywhere.
 */
export const PublicBookingPage = ({ siteKey, branding, embed, style }: PublicBookingPageProps): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const isEmbed = embed === true;
    const widgetStyle = style || 'light';
    const brandColor = branding?.primaryColor || '#4f46e5';

    return (
        <BareLayout title={`Book Inspection | ${siteName}`} branding={branding}>
            <div
                data-widget-embed={isEmbed ? '1' : '0'}
                data-widget-style={widgetStyle}
                {...(isEmbed ? { style: `--widget-brand:${brandColor}` } : {})}
                class={isEmbed
                    ? 'oi-widget-embed relative min-h-screen py-8 px-4 font-sans'
                    : 'relative min-h-screen py-12 px-4 sm:px-6 lg:px-8 font-sans bg-slate-50'}
                x-data="bookingPage()"
            >
                <div class={isEmbed ? 'max-w-2xl mx-auto' : 'max-w-2xl mx-auto'}>
                    {!isEmbed && (
                        <nav class="mb-8 flex items-center gap-3">
                            {branding?.logoUrl
                                ? <img src={branding.logoUrl} alt={siteName} class="h-9 w-auto" />
                                : (
                                    <div class="w-9 h-9 bg-indigo-600 rounded-md flex items-center justify-center">
                                        <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                    </div>
                                )}
                            <span class="text-[18px] font-semibold tracking-tight text-slate-900">{siteName}</span>
                        </nav>
                    )}

                    <div class="bg-white rounded-lg shadow-sm border border-slate-200 p-6 md:p-10">
                        <div class="mb-8 space-y-2">
                            <h1 class="text-[22px] font-bold tracking-tight text-slate-900">Schedule an inspection</h1>
                            <p class="text-[14px] text-slate-500 leading-relaxed">Tell us about the property and pick a time that works.</p>
                        </div>

                        <form id="bookingForm" class="space-y-10" {...{ 'x-on:submit.prevent': 'submitBooking($event)' }}>
                            {/* ── Property ─────────────────────────────────── */}
                            <section class="space-y-5">
                                <div class="space-y-1">
                                    <h2 class="text-[18px] font-semibold tracking-tight text-slate-900">Property</h2>
                                    <p class="text-[13px] text-slate-500">Where is the inspection?</p>
                                </div>
                                <AddressAutocomplete name="address" required={true} />
                            </section>

                            {/* ── Your info ────────────────────────────────── */}
                            <section class="space-y-5">
                                <div class="space-y-1">
                                    <h2 class="text-[18px] font-semibold tracking-tight text-slate-900">Your info</h2>
                                    <p class="text-[13px] text-slate-500">How do we reach you with the report?</p>
                                </div>
                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <label class="block">
                                        <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Full name</span>
                                        <input
                                            type="text"
                                            name="clientName"
                                            required
                                            placeholder="Jane Doe"
                                            class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-[14px] font-medium transition-colors"
                                        />
                                    </label>
                                    <label class="block">
                                        <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Email</span>
                                        <input
                                            type="email"
                                            name="clientEmail"
                                            required
                                            placeholder="jane@example.com"
                                            class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-[14px] font-medium transition-colors"
                                        />
                                    </label>
                                </div>
                            </section>

                            {/* ── Services (Sprint 2 S2-2) ───────────────────── */}
                            <section class="space-y-5" x-show="hasServices" style="display:none">
                                <div class="space-y-1">
                                    <h2 class="text-[18px] font-semibold tracking-tight text-slate-900">Services</h2>
                                    <p class="text-[13px] text-slate-500">Choose one or more inspections for this visit.</p>
                                </div>
                                <div class="space-y-2">
                                    <template x-for="svc in availableServices" {...{ 'x-bind:key': 'svc.id' }}>
                                        <label class="block cursor-pointer">
                                            <input
                                                type="checkbox"
                                                x-model="selectedServiceIds"
                                                {...{ 'x-bind:value': 'svc.id' }}
                                                class="sr-only peer"
                                            />
                                            <div class="px-4 py-3 rounded-md border border-slate-200 bg-white peer-checked:border-indigo-500 peer-checked:bg-indigo-50 peer-checked:ring-2 peer-checked:ring-indigo-500/10 transition-all flex items-center justify-between gap-3">
                                                <div class="min-w-0">
                                                    <div class="text-[13px] font-bold text-slate-900 truncate" x-text="svc.name"></div>
                                                    <div class="text-[11px] text-slate-500 mt-0.5" x-text="(svc.durationMinutes ? svc.durationMinutes + ' min · ' : '') + '$' + (svc.price / 100).toFixed(2)"></div>
                                                </div>
                                                <svg
                                                    class="w-4 h-4 text-indigo-500 flex-shrink-0"
                                                    {...{ 'x-bind:class': "selectedServiceIds.includes(svc.id) ? '' : 'opacity-0'" }}
                                                    fill="currentColor"
                                                    viewBox="0 0 20 20"
                                                >
                                                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
                                                </svg>
                                            </div>
                                        </label>
                                    </template>
                                </div>
                                <div
                                    x-show="selectedServiceIds.length > 0"
                                    style="display:none"
                                    class="px-4 py-2 rounded-md bg-slate-50 flex items-center justify-between"
                                >
                                    <span class="text-[12px] font-bold text-slate-700">
                                        <span x-text="selectedServiceIds.length"></span>
                                        <span x-text="selectedServiceIds.length === 1 ? 'inspection' : 'inspections'"></span>
                                    </span>
                                    <span class="text-[15px] font-bold text-slate-900 tabular-nums" x-text="'$' + (totalPriceCents / 100).toFixed(2)"></span>
                                </div>
                            </section>

                            {/* ── Schedule ─────────────────────────────────── */}
                            <section class="space-y-5">
                                <div class="space-y-1">
                                    <h2 class="text-[18px] font-semibold tracking-tight text-slate-900">Schedule</h2>
                                    <p class="text-[13px] text-slate-500">Pick a date and time window that works.</p>
                                </div>

                                {/* Date — text input + JS mask, locale-stable English placeholder. */}
                                <label class="block">
                                    <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Inspection date</span>
                                    <input
                                        type="text"
                                        name="dateMasked"
                                        x-model="dateMasked"
                                        {...{
                                            'x-on:input':  'formatDate($event)',
                                            'x-on:blur':   'validateDate()',
                                        }}
                                        placeholder="MM / DD / YYYY"
                                        autocomplete="off"
                                        inputmode="numeric"
                                        required
                                        pattern="\\d{2}\\s*/\\s*\\d{2}\\s*/\\s*\\d{4}"
                                        class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-[14px] font-medium tabular-nums transition-colors"
                                        aria-describedby="date-hint date-error"
                                    />
                                    <p id="date-hint" class="mt-1 text-[11px] text-slate-400">Format: MM / DD / YYYY</p>
                                    <p
                                        id="date-error"
                                        x-show="dateError"
                                        style="display:none"
                                        class="mt-1 text-[11px] text-rose-600 font-medium"
                                        x-text="dateError"
                                    ></p>
                                </label>

                                {/* Time window — 4 radio cards. */}
                                <div class="space-y-1">
                                    <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Time window</span>
                                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                                        <template x-for="w in windowOptions" {...{ 'x-bind:key': 'w.id' }}>
                                            <label class="cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name="timeSlot"
                                                    x-model="selectedWindow"
                                                    {...{ 'x-bind:value': 'w.id' }}
                                                    class="sr-only peer"
                                                    required
                                                />
                                                <div class="px-3 py-2.5 rounded-md border border-slate-200 bg-white peer-checked:border-indigo-500 peer-checked:bg-indigo-50 peer-checked:ring-2 peer-checked:ring-indigo-500/10 peer-focus:ring-2 peer-focus:ring-indigo-500/40 transition-all">
                                                    <div class="text-[13px] font-bold text-slate-900" x-text="w.label"></div>
                                                    <div class="text-[11px] text-slate-500 mt-0.5" x-text="w.detail"></div>
                                                </div>
                                            </label>
                                        </template>
                                    </div>

                                    {/* Custom time picker — only when "custom" is chosen. */}
                                    <div
                                        x-show="selectedWindow === 'custom'"
                                        style="display:none"
                                        {...{
                                            'x-transition:enter':       'ease-out duration-150',
                                            'x-transition:enter-start': 'opacity-0 -translate-y-1',
                                            'x-transition:enter-end':   'opacity-100 translate-y-0',
                                        }}
                                        class="mt-3 flex items-center gap-2"
                                    >
                                        <input
                                            type="time"
                                            name="customTime"
                                            x-model="customTime"
                                            class="h-9 px-3 rounded-md border border-slate-200 bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-[13px] font-medium tabular-nums"
                                        />
                                        <span class="text-[11px] text-slate-400">on selected date</span>
                                    </div>
                                </div>
                            </section>

                            {/* Verification */}
                            <div class="pt-2 flex justify-center">
                                <div class="cf-turnstile" data-sitekey={siteKey}></div>
                            </div>

                            <button
                                type="submit"
                                id="submitBtn"
                                {...{ 'x-bind:disabled': 'submitting' }}
                                class="w-full h-11 px-4 bg-indigo-600 text-white rounded-md font-bold text-[14px] hover:bg-indigo-700 active:scale-[.98] transition-all disabled:bg-slate-300 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                            >
                                <span x-show="!submitting">Request inspection</span>
                                <span x-show="submitting" style="display:none">Submitting…</span>
                            </button>
                        </form>

                        <div
                            id="message"
                            x-show="message"
                            style="display:none"
                            x-text="message"
                            {...{ 'x-bind:class': "messageOk ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'" }}
                            class="mt-6 p-3 rounded-md text-center text-[13px] font-semibold"
                        ></div>
                    </div>

                    {!isEmbed && (
                        <p class="text-center text-[11px] text-slate-400 mt-6">Powered by {siteName}</p>
                    )}
                </div>

                {isEmbed && (
                    <script dangerouslySetInnerHTML={{ __html: `
                        (function() {
                            function postHeight() {
                                var h = document.documentElement.scrollHeight;
                                window.parent.postMessage({ type: 'oi:widget:height', height: h }, '*');
                            }
                            window.addEventListener('load', postHeight);
                            new ResizeObserver(postHeight).observe(document.documentElement);
                            window.addEventListener('oi:widget:event', function(e) {
                                window.parent.postMessage({ type: 'oi:widget:event', event: e.detail.event, metadata: e.detail.metadata || {} }, '*');
                            });
                            setTimeout(function() {
                                window.dispatchEvent(new CustomEvent('oi:widget:event', { detail: { event: 'view' } }));
                            }, 50);
                        })();
                    ` }} />
                )}
            </div>
            <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
            <script src="/js/address-autocomplete.js"></script>
            <script src="/js/booking.js"></script>
        </BareLayout>
    );
};
