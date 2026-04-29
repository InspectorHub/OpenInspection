import { BareLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

interface AgreementSignProps {
    token: string;
    agreementName: string;
    agreementContent: string;
    clientName: string | null;
    status: 'pending' | 'viewed' | 'signed';
    branding?: BrandingConfig | undefined;
    /** Optional variables substituted into the agreement HTML body (e.g. {{client_name}}). */
    vars?: {
        client_name?: string;
        property_address?: string;
        inspection_date?: string;
        inspector_name?: string;
    } | undefined;
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Replace {{var}} placeholders with the provided values; missing vars become empty strings. */
function substituteVars(template: string, vars: Record<string, string | undefined>): string {
    return template.replace(/\{\{(client_name|property_address|inspection_date|inspector_name)\}\}/g,
        (_m, key) => escapeHtml(vars[key] ?? ''));
}

/**
 * Backward-compat: if the stored content does not look like HTML (no leading `<` tag),
 * treat it as plain text and wrap paragraphs / preserve line breaks.
 */
function renderAgreementContent(raw: string): string {
    if (!raw) return '';
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('<')) return raw; // HTML from Quill — render as-is
    // plain text → paragraph wrap, escape angle brackets first to avoid HTML injection
    const escaped = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<p>' + escaped.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
}

export const AgreementSignPage = ({ token, agreementName, agreementContent, clientName, status, branding, vars }: AgreementSignProps): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const alreadySigned = status === 'signed';
    const renderedHtml = substituteVars(renderAgreementContent(agreementContent || ''), {
        client_name: vars?.client_name ?? clientName ?? '',
        property_address: vars?.property_address ?? '',
        inspection_date: vars?.inspection_date ?? '',
        inspector_name: vars?.inspector_name ?? '',
    });

    return (
        <BareLayout title={`Sign Agreement | ${siteName}`} branding={branding}>
            <div class="min-h-screen bg-slate-50 py-12 px-4 font-sans">
                <div class="max-w-2xl mx-auto">
                    {/* Header */}
                    <div class="flex items-center gap-3 mb-10">
                        <div class="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
                            <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                        </div>
                        <span class="text-xl font-black text-slate-900">{siteName}</span>
                    </div>

                    <div class="bg-white rounded-3xl shadow-xl shadow-slate-200/50 overflow-hidden">
                        {/* Title bar */}
                        <div class="px-10 py-8 border-b border-slate-100">
                            <p class="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600 mb-2">Document for Signature</p>
                            <h1 class="text-3xl font-black text-slate-900 tracking-tight">{agreementName}</h1>
                            {clientName && <p class="text-slate-500 font-semibold mt-1">Hi, {clientName}</p>}
                        </div>

                        {/* Agreement content */}
                        <div class="px-10 py-8 border-b border-slate-100 max-h-96 overflow-y-auto">
                            <div
                                id="agreementContent"
                                class="prose prose-slate max-w-none text-sm text-slate-700 leading-relaxed font-medium"
                                style="font-size:15px;line-height:1.7;color:#1e293b;"
                                dangerouslySetInnerHTML={{ __html: renderedHtml }}
                            ></div>
                        </div>

                        {/* Signature area */}
                        {alreadySigned ? (
                            <div class="px-10 py-10 text-center">
                                <div class="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <svg class="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                </div>
                                <h2 class="text-xl font-black text-slate-900 mb-2">Already Signed</h2>
                                <p class="text-slate-500 font-semibold">This agreement has been signed. Thank you!</p>
                            </div>
                        ) : (
                            <>
                                <div class="px-10 py-8" id="signSection">
                                    <p class="text-sm font-bold text-slate-500 mb-4">Draw your signature below:</p>
                                    <div class="border-2 border-slate-200 rounded-2xl overflow-hidden bg-slate-50 mb-6" style="touch-action: none;">
                                        <canvas id="sigCanvas" width="580" height="180" class="w-full cursor-crosshair block"></canvas>
                                    </div>
                                    <div class="flex gap-3">
                                        <button onclick="clearSig()" class="flex-1 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest text-slate-400 hover:bg-slate-50 border border-slate-200 transition">Clear</button>
                                        <button onclick="submitSignature()" id="submitSigBtn" class="flex-[2] py-3 rounded-2xl bg-indigo-600 text-white font-black text-[10px] uppercase tracking-widest shadow-lg shadow-indigo-200 hover:bg-slate-900 transition">Sign Agreement</button>
                                    </div>
                                </div>
                                <div id="sigSuccess" class="hidden px-10 py-10 text-center">
                                    <div class="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
                                        <svg class="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                    </div>
                                    <p class="text-lg font-black text-slate-900">Signed successfully!</p>
                                    <p class="text-slate-500 font-semibold text-sm mt-1">Thank you for signing this agreement.</p>
                                </div>
                            </>
                        )}
                    </div>

                    <p class="text-center text-xs text-slate-400 font-semibold mt-8">Powered by {siteName}</p>
                </div>
            </div>

            <script dangerouslySetInnerHTML={{ __html: `
                var TOKEN = '${token.replace(/'/g, "\\'")}';
                var canvas = document.getElementById('sigCanvas');
                var ctx = canvas ? canvas.getContext('2d') : null;
                var drawing = false;
                var hasMark = false;

                function getPos(e) {
                    var r = canvas.getBoundingClientRect();
                    var src = e.touches ? e.touches[0] : e;
                    return { x: (src.clientX - r.left) * (canvas.width / r.width), y: (src.clientY - r.top) * (canvas.height / r.height) };
                }

                if (canvas && ctx) {
                    ctx.strokeStyle = '#1e293b';
                    ctx.lineWidth = 2.5;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';

                    canvas.addEventListener('mousedown', function(e) { drawing = true; var p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
                    canvas.addEventListener('mousemove', function(e) { if (!drawing) return; hasMark = true; var p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
                    canvas.addEventListener('mouseup', function() { drawing = false; });
                    canvas.addEventListener('mouseleave', function() { drawing = false; });
                    canvas.addEventListener('touchstart', function(e) { e.preventDefault(); drawing = true; var p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: false });
                    canvas.addEventListener('touchmove', function(e) { e.preventDefault(); if (!drawing) return; hasMark = true; var p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }, { passive: false });
                    canvas.addEventListener('touchend', function() { drawing = false; });
                }

                function clearSig() {
                    if (ctx) { ctx.clearRect(0, 0, canvas.width, canvas.height); hasMark = false; }
                }

                async function submitSignature() {
                    if (!hasMark) { alert('Please draw your signature before submitting.'); return; }
                    var signatureBase64 = canvas.toDataURL('image/png');
                    var btn = document.getElementById('submitSigBtn');
                    btn.disabled = true;
                    btn.textContent = 'Signing...';
                    try {
                        var res = await fetch('/api/public/agreements/' + TOKEN + '/sign', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ signatureBase64 })
                        });
                        if (res.ok) {
                            document.getElementById('signSection').classList.add('hidden');
                            document.getElementById('sigSuccess').classList.remove('hidden');
                        } else {
                            var d = await res.json();
                            alert(d.error?.message || 'Signing failed. Please try again.');
                            btn.disabled = false;
                            btn.textContent = 'Sign Agreement';
                        }
                    } catch (e) {
                        alert('Network error. Please try again.');
                        btn.disabled = false;
                        btn.textContent = 'Sign Agreement';
                    }
                }
            ` }}></script>
        </BareLayout>
    );
};
