/**
 * Spec 5H P1.1 — Certificate of Completion (1-page evidence PDF).
 *
 * Reached only via /internal/cert-render/{token} which is M2M-authed
 * (Bearer JWT_SECRET). Browser Rendering captures this as cert.pdf.
 *
 * Layout follows spec §4.1: envelope ID, document hash, recipient,
 * signature image + hash, event timeline, cryptographic proof block,
 * verifier URL, ESIGN Act footer.
 */

interface CertEvent {
    event: string;
    timestampUtc: string;
    actor?: string | undefined;
    ip?: string | null | undefined;
    country?: string | null | undefined;
    ua?: string | null | undefined;
}

interface CertTemplateProps {
    envelopeId: string;
    documentTitle: string;
    documentHash: string | null;          // hex SHA-256, or null if cert generated before signed.pdf hash known
    recipientName: string | null;
    recipientEmail: string;
    identityMethod: string;                // 'Email link verification' for now
    signatureImageHash: string | null;     // hex SHA-256 of decoded canvas bytes
    signatureBase64: string | null;        // for embedded thumbnail
    events: CertEvent[];
    keyFingerprint: string | null;
    keyAlgorithm: string;                  // 'Ed25519'
    verifyUrl: string;
    siteName: string;
    generatedAtUtcIso: string;
}

function ensureDataUri(b64: string | null): string {
    if (!b64) return '';
    if (b64.startsWith('data:')) return b64;
    return 'data:image/png;base64,' + b64;
}

function shortHash(hex: string | null): string {
    if (!hex) return '—';
    if (hex.length <= 16) return hex;
    return hex.slice(0, 8) + '…' + hex.slice(-8);
}

function fmtUa(ua: string | null | undefined): string {
    if (!ua) return '—';
    // Best-effort browser/version extract for readability
    const m = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)\/(\d+)/);
    return m ? `${m[1]} ${m[2]}` : ua.slice(0, 40);
}

function eventLabel(ev: string): string {
    return ev.replace(/\./g, '.').replace(/_/g, ' ');
}

export function CertTemplatePage(props: CertTemplateProps): JSX.Element {
    const sigSrc = ensureDataUri(props.signatureBase64);
    return (
        <html>
            <head>
                <meta charSet="utf-8" />
                <title>Certificate of Completion · {props.envelopeId}</title>
                <style dangerouslySetInnerHTML={{ __html: `
                    *{box-sizing:border-box}
                    body{font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;color:#1e293b;font-size:11px;line-height:1.55;margin:0;padding:32px}
                    .header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:2px solid #1e293b;padding-bottom:14px;margin-bottom:18px}
                    .title{font-size:18px;font-weight:700;letter-spacing:-0.01em;margin:0}
                    .subtitle{font-size:10px;font-family:"JetBrains Mono",monospace;color:#64748b;margin-top:2px}
                    .brand{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#475569;text-align:right}
                    .section{margin-bottom:14px}
                    .section-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;margin-bottom:5px}
                    .row{display:grid;grid-template-columns:120px 1fr;gap:8px;margin-bottom:3px}
                    .row-key{font-size:10px;color:#64748b}
                    .row-val{font-size:11px;color:#1e293b;word-break:break-all}
                    .row-val.mono{font-family:"JetBrains Mono",monospace;font-size:10px}
                    .sig-img{display:block;height:60px;max-width:200px;border-bottom:1px solid #94a3b8;margin-top:6px}
                    table.timeline{width:100%;border-collapse:collapse;font-size:10px}
                    table.timeline th{text-align:left;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:8px}
                    table.timeline td{padding:5px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top}
                    table.timeline td.ts{font-family:"JetBrains Mono",monospace;color:#475569;white-space:nowrap}
                    table.timeline td.ev{font-weight:600}
                    .crypto-block{background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:10px 12px;margin-top:6px}
                    .footer{margin-top:24px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:8.5px;color:#475569;line-height:1.5}
                    .footer-meta{margin-top:8px;font-size:8px;color:#94a3b8;font-family:"JetBrains Mono",monospace}
                    @media print{body{padding:0}}
                `}} />
            </head>
            <body>
                <div class="header">
                    <div>
                        <h1 class="title">Certificate of Completion</h1>
                        <div class="subtitle">Envelope ID: {props.envelopeId}</div>
                    </div>
                    <div class="brand">{props.siteName}</div>
                </div>

                <div class="section">
                    <div class="section-label">Document</div>
                    <div class="row"><div class="row-key">Title</div><div class="row-val">{props.documentTitle}</div></div>
                    <div class="row"><div class="row-key">SHA-256</div><div class="row-val mono">{props.documentHash ?? '— (cert generated before document hash available)'}</div></div>
                </div>

                <div class="section">
                    <div class="section-label">Recipient</div>
                    <div class="row"><div class="row-key">Name</div><div class="row-val">{props.recipientName ?? '—'}</div></div>
                    <div class="row"><div class="row-key">Email</div><div class="row-val">{props.recipientEmail}</div></div>
                    <div class="row"><div class="row-key">Identity</div><div class="row-val">{props.identityMethod}</div></div>
                </div>

                <div class="section">
                    <div class="section-label">Signature</div>
                    <div class="row"><div class="row-key">Method</div><div class="row-val">Drawn (HTML5 canvas)</div></div>
                    <div class="row"><div class="row-key">Image SHA-256</div><div class="row-val mono">{shortHash(props.signatureImageHash)}</div></div>
                    {sigSrc ? <img class="sig-img" src={sigSrc} alt="Signature" /> : null}
                </div>

                <div class="section">
                    <div class="section-label">Event Timeline</div>
                    <table class="timeline">
                        <thead>
                            <tr><th>UTC Time</th><th>Event</th><th>Actor / IP</th><th>UA / Country</th></tr>
                        </thead>
                        <tbody>
                            {props.events.map((ev, i) => (
                                <tr key={i}>
                                    <td class="ts">{ev.timestampUtc}</td>
                                    <td class="ev">{eventLabel(ev.event)}</td>
                                    <td>{ev.actor ?? ev.ip ?? '—'}</td>
                                    <td>{fmtUa(ev.ua)}{ev.country ? ` / ${ev.country}` : ''}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div class="section">
                    <div class="section-label">Cryptographic Proof</div>
                    <div class="crypto-block">
                        <div class="row"><div class="row-key">Algorithm</div><div class="row-val mono">{props.keyAlgorithm} (RFC 8032)</div></div>
                        <div class="row"><div class="row-key">Tenant Key Fingerprint</div><div class="row-val mono">{shortHash(props.keyFingerprint)}</div></div>
                        <div class="row"><div class="row-key">Verify URL</div><div class="row-val mono">{props.verifyUrl}</div></div>
                    </div>
                </div>

                <div class="footer">
                    This certificate constitutes evidence under the United States Electronic Signatures in Global
                    and National Commerce Act (15 U.S.C. § 7001 et seq.) and the Uniform Electronic Transactions
                    Act (UETA). The cryptographic chain above can be independently verified by any third party
                    using the public key at the verify URL — no cooperation from {props.siteName} is required.
                    <div class="footer-meta">Generated {props.generatedAtUtcIso} · {props.siteName}</div>
                </div>
            </body>
        </html>
    );
}
