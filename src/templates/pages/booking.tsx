import { BareLayout } from '../layouts/main-layout';
import { AtmosphericBg } from '../components/atmospheric-bg';
import { BrandingConfig } from '../../types/auth';

interface PublicBookingPageProps {
    siteKey: string;
    branding?: BrandingConfig | undefined;
    embed?: boolean;
    style?: 'light' | 'dark' | 'branded';
}

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
                    : 'relative min-h-screen py-20 px-6 lg:px-8 font-sans overflow-hidden'}
            >
                {!isEmbed && <AtmosphericBg />}

                <div class={isEmbed ? 'max-w-2xl mx-auto' : 'max-w-3xl mx-auto animate-fade-in'}>
                    {!isEmbed && (
                        <nav class="mb-16 flex items-center justify-between">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-md">
                                     <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                </div>
                                <span class="text-xl font-bold text-slate-900 tracking-tight">{siteName}</span>
                            </div>
                        </nav>
                    )}

                    <div class="glass-panel p-6 md:p-16 rounded-2xl shadow-md border border-white/40">
                        <div class="mb-16">
                            <div class="flex items-center gap-2 mb-4">
                                <span class="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
                                <span class="text-[10px] font-bold text-indigo-600 uppercase tracking-[0.3em]">Book Inspection</span>
                            </div>
                            <h1 class="text-3xl font-bold text-slate-900 tracking-tight mb-4 leading-none">Schedule Inspection</h1>
                            <p class="text-slate-500 text-lg font-semibold tracking-tight">Professional property analysis configured for high-fidelity reporting.</p>
                        </div>

                        <form id="bookingForm" class="space-y-12">
                            {/* Property Details */}
                            <div class="space-y-8">
                                <h3 class="text-xs font-bold text-indigo-600 uppercase tracking-[0.3em] ml-1">Phase I: Property Parameters</h3>
                                <div class="grid grid-cols-1 gap-4">
                                    <div class="space-y-3">
                                        <label class="block text-xs font-bold text-slate-900 ml-1 uppercase tracking-widest">Site Address</label>
                                        <div class="relative group">
                                            <div class="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition-opacity"></div>
                                            <input type="text" name="address" required placeholder="123 Inspection Way, City, State"
                                                class="premium-input relative w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder:text-slate-300 font-bold text-sm" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Client Details */}
                            <div class="space-y-8">
                                <h3 class="text-xs font-bold text-indigo-600 uppercase tracking-[0.3em] ml-1">Phase II: Client Information</h3>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div class="space-y-3">
                                        <label class="block text-xs font-bold text-slate-900 ml-1 uppercase tracking-widest">Full Name</label>
                                        <div class="relative group">
                                            <div class="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition-opacity"></div>
                                            <input type="text" name="clientName" required placeholder="John Doe"
                                                class="premium-input relative w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder:text-slate-300 font-bold text-sm" />
                                        </div>
                                    </div>
                                    <div class="space-y-3">
                                        <label class="block text-xs font-bold text-slate-900 ml-1 uppercase tracking-widest">Email</label>
                                        <div class="relative group">
                                            <div class="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition-opacity"></div>
                                            <input type="email" name="clientEmail" required placeholder="john@example.com"
                                                class="premium-input relative w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder:text-slate-300 font-bold text-sm" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Scheduling */}
                            <div class="space-y-8">
                                <h3 class="text-xs font-bold text-indigo-600 uppercase tracking-[0.3em] ml-1">Phase III: Scheduling</h3>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div class="space-y-3">
                                        <label class="block text-xs font-bold text-slate-900 ml-1 uppercase tracking-widest">Inspection Date</label>
                                        <div class="relative group">
                                            <div class="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition-opacity"></div>
                                            <input type="date" name="date" required
                                                class="premium-input relative w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-indigo-600 outline-none transition-all font-bold text-sm" />
                                        </div>
                                    </div>
                                    <div class="space-y-3">
                                        <label class="block text-xs font-bold text-slate-900 ml-1 uppercase tracking-widest">Window Preference</label>
                                        <div class="relative group">
                                            <div class="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition-opacity"></div>
                                            <select name="timeSlot" required class="premium-input relative w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-indigo-600 outline-none transition-all appearance-none bg-no-repeat bg-[right_1.5rem_center] cursor-pointer font-bold text-sm">
                                                <option value="morning">Morning (8:00 AM - 12:00 PM)</option>
                                                <option value="afternoon">Afternoon (1:00 PM - 5:00 PM)</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Verification */}
                            <div class="pt-6 flex justify-center">
                                <div class="cf-turnstile" data-sitekey={siteKey}></div>
                            </div>

                            <button type="submit" id="submitBtn"
                                class="premium-button w-full py-6 px-10 rounded-2xl bg-slate-900 text-white font-black text-xs uppercase tracking-[0.3em] shadow-[0_20px_50px_rgba(0,0,0,0.2)] hover:bg-black transition-all active:scale-95 disabled:bg-slate-300 disabled:pointer-events-none">
                                Submit Request
                            </button>
                        </form>

                        <div id="message" class="mt-12 p-6 rounded-2xl text-center font-black text-sm uppercase tracking-widest hidden animate-fade-in"></div>
                    </div>
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
            <script src="/js/booking.js"></script>
        </BareLayout>
    );
};
