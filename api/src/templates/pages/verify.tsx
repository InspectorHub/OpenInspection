/**
 * Spec 5H P2 — Public verifier UI.
 *
 * Reached at /verify/{envelopeId}. NO authentication. Anyone — opposing
 * counsel, court clerk, the client themselves — can independently verify
 * the e-signature chain. Critical for court-admissibility (removes the
 * "vendor must testify to its own integrity" weakness).
 */

import { BareLayout } from '../layouts/main-layout';

interface VerifierEvent {
    event: string;
    createdAtUtc: string;
    valid: boolean;
    payload: Record<string, unknown>;
    hash: string;
}

interface VerifierProps {
    envelopeId: string;
    found: boolean;
    chainValid: boolean;
    chainReason: string | null;
    documentTitle: string | null;
    clientName: string | null;
    clientEmail: string | null;
    keyFingerprint: string | null;
    keyAlgorithm: string;
    eventCount: number;
    events: VerifierEvent[];
    siteName: string;
    apiBase: string;
}

function shortHash(hex: string | null): string {
    if (!hex) return '—';
    if (hex.length <= 16) return hex;
    return hex.slice(0, 8) + '…' + hex.slice(-8);
}

export function VerifyPage(props: VerifierProps): JSX.Element {
    if (!props.found) {
        return (
            <BareLayout title={`Envelope not found · Verify · ${props.siteName}`}>
                <div style="padding:48px;text-align:center;color:var(--ih-fg-2, #475569)">
                    <h1 style="font-size:20px;font-weight:700;color:#dc2626">Envelope not found</h1> {/* dc2626: no token equivalent */}
                    <p style="margin-top:8px">The envelope ID <code>{props.envelopeId}</code> does not exist.</p>
                </div>
            </BareLayout>
        );
    }
    return (
        <html>
            <head>
                <meta charSet="utf-8" />
                <title>Verify {props.envelopeId.slice(0, 8)} · {props.siteName}</title>
                <style dangerouslySetInnerHTML={{ __html: `
                    *{box-sizing:border-box}
                    body{font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;color:var(--ih-slate-800, #1e293b);background:var(--ih-bg-app, #f8fafc);margin:0;padding:32px}
                    .container{max-width:760px;margin:0 auto}
                    .verdict{padding:18px 24px;border-radius:8px;border:1px solid;font-weight:600;font-size:14px;margin-bottom:24px;display:flex;align-items:center;gap:12px}
                    .verdict.valid{background:var(--ih-status-ok-bg, #ecfdf5);border-color:#a7f3d0;color:var(--ih-status-ok-fg, #047857)} /* a7f3d0: no token equivalent */
                    .verdict.invalid{background:var(--ih-status-bad-bg, #fef2f2);border-color:#fecaca;color:#991b1b} /* fecaca, 991b1b: no token equivalent */
                    .icon{font-size:20px}
                    .panel{background:var(--ih-bg-card, #fff);border:1px solid var(--ih-slate-200, #e2e8f0);border-radius:8px;padding:20px 24px;margin-bottom:16px}
                    .panel-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--ih-fg-3, #64748b);margin:0 0 12px}
                    .row{display:grid;grid-template-columns:160px 1fr;gap:12px;margin-bottom:6px}
                    .row-key{font-size:12px;color:var(--ih-fg-3, #64748b)}
                    .row-val{font-size:13px;color:var(--ih-slate-800, #1e293b);word-break:break-all}
                    .row-val.mono{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px}
                    table.events{width:100%;border-collapse:collapse;font-size:12px}
                    table.events th{text-align:left;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--ih-fg-3, #64748b);padding:6px 8px;border-bottom:1px solid var(--ih-slate-200, #e2e8f0);font-size:9px}
                    table.events td{padding:8px;border-bottom:1px solid var(--ih-bg-muted, #f1f5f9);vertical-align:top}
                    .evt-ok{color:var(--ih-status-ok, #10b981)}
                    .evt-bad{color:var(--ih-status-bad, #ef4444)}
                    .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
                    .btn{display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 14px;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none;border:1px solid var(--ih-slate-200, #e2e8f0);color:var(--ih-slate-800, #1e293b);background:var(--ih-bg-card, #fff)}
                    .btn:hover{background:var(--ih-bg-muted, #f1f5f9)}
                    .footer{margin-top:32px;padding-top:16px;border-top:1px solid var(--ih-slate-200, #e2e8f0);font-size:10px;color:var(--ih-fg-3, #64748b);line-height:1.6}
                    code{background:var(--ih-bg-muted, #f1f5f9);padding:1px 6px;border-radius:4px;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px}
                    pre{background:var(--ih-slate-900, #0f172a);color:var(--ih-slate-200, #e2e8f0);padding:12px;border-radius:6px;font-size:11px;overflow-x:auto;line-height:1.5}
                `}} />
            </head>
            <body>
                <div class="container">
                    <div class={`verdict ${props.chainValid ? 'valid' : 'invalid'}`}>
                        <span class="icon">{props.chainValid ? '✓' : '✗'}</span>
                        <span>
                            {props.chainValid
                                ? `Verified — all ${props.eventCount} events cryptographically signed and chained.`
                                : `Verification failed at ${props.chainReason ?? 'unknown'}. Chain integrity compromised.`}
                        </span>
                    </div>

                    <div class="panel">
                        <h2 class="panel-title">Envelope</h2>
                        <div class="row"><div class="row-key">Envelope ID</div><div class="row-val mono">{props.envelopeId}</div></div>
                        <div class="row"><div class="row-key">Document</div><div class="row-val">{props.documentTitle ?? '—'}</div></div>
                        <div class="row"><div class="row-key">Recipient</div><div class="row-val">{props.clientName ?? '—'} · {props.clientEmail ?? '—'}</div></div>
                    </div>

                    <div class="panel">
                        <h2 class="panel-title">Chain of Custody — {props.eventCount} events</h2>
                        <table class="events">
                            <thead><tr><th>UTC Time</th><th>Event</th><th>Hash</th><th>Status</th></tr></thead>
                            <tbody>
                                {props.events.map((ev, i) => (
                                    <tr key={i}>
                                        <td style="font-family:monospace;font-size:11px;color:var(--ih-fg-2, #475569);white-space:nowrap">{ev.createdAtUtc}</td>
                                        <td style="font-weight:600">{ev.event}</td>
                                        <td class="row-val mono">{shortHash(ev.hash)}</td>
                                        <td class={ev.valid ? 'evt-ok' : 'evt-bad'} style="font-weight:600">{ev.valid ? '✓ valid' : '✗ invalid'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div class="panel">
                        <h2 class="panel-title">Cryptographic Proof</h2>
                        <div class="row"><div class="row-key">Algorithm</div><div class="row-val mono">{props.keyAlgorithm} (RFC 8032)</div></div>
                        <div class="row"><div class="row-key">Key Fingerprint</div><div class="row-val mono">{shortHash(props.keyFingerprint)}</div></div>
                        <div class="actions">
                            <a class="btn" href={`${props.apiBase}/api/public/verify/${props.envelopeId}/public-key`}>Download Public Key</a>
                            <a class="btn" href={`${props.apiBase}/api/public/verify/${props.envelopeId}/audit-trail`}>Download Audit JSON</a>
                            <a class="btn" href={`${props.apiBase}/api/public/verify/${props.envelopeId}/document`} target="_blank">View Signed Document</a>
                            <a class="btn" href={`${props.apiBase}/api/public/verify/${props.envelopeId}`}>JSON API</a>
                        </div>
                    </div>

                    <div class="panel">
                        <h2 class="panel-title">Verify Yourself</h2>
                        <p style="font-size:12px;color:var(--ih-fg-2, #475569);margin:0 0 12px">Re-run the verification offline using openssl + the public key:</p>
                        <pre>{`# 1. Download public key + audit JSON\ncurl -o pubkey.pem ${props.apiBase}/api/public/verify/${props.envelopeId}/public-key\ncurl -o audit.json ${props.apiBase}/api/public/verify/${props.envelopeId}/audit-trail\n\n# 2. For each event in audit.json, decode hash + signature, then:\n#   openssl pkeyutl -verify -pubin -inkey pubkey.pem \\\n#     -sigfile event.sig -in event.hash`}</pre>
                    </div>

                    <div class="footer">
                        This certificate constitutes evidence under the United States Electronic Signatures in Global and National Commerce Act
                        (15 U.S.C. § 7001 et seq.) and the Uniform Electronic Transactions Act (UETA). The cryptographic chain above can be
                        independently verified by any third party using the public key — no cooperation from {props.siteName} is required.
                    </div>
                </div>
            </body>
        </html>
    );
}
