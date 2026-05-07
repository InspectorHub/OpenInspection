/**
 * Spec 5H P1 — Canonical signed agreement (rendered to PDF by Browser Rendering).
 *
 * Reached only via /internal/agreement-render/{token} which is M2M-authed
 * (Bearer JWT_SECRET). Output is the immutable, frozen "what the client saw
 * and agreed to" — variables substituted, signature image embedded, no UI.
 *
 * Hashed by the workflow's render-canonical-pdf step → SHA-256 stored in
 * the workflow.complete audit row → forms the document binding in the chain.
 */

interface AgreementPrintableProps {
    agreementName: string;
    /** Substituted HTML body (placeholders already replaced server-side). */
    bodyHtml: string;
    clientName: string | null;
    clientEmail: string;
    /** base64 PNG signature image (data: prefix optional). */
    signatureBase64: string | null;
    signedAtUtcIso: string | null;
    envelopeId: string;
}

function ensureDataUri(b64: string | null): string {
    if (!b64) return '';
    if (b64.startsWith('data:')) return b64;
    return 'data:image/png;base64,' + b64;
}

export function AgreementPrintablePage(props: AgreementPrintableProps): JSX.Element {
    const sigSrc = ensureDataUri(props.signatureBase64);
    return (
        <html>
            <head>
                <meta charSet="utf-8" />
                <title>{props.agreementName}</title>
                <style dangerouslySetInnerHTML={{ __html: `
                    *{box-sizing:border-box}
                    body{font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;color:#1e293b;font-size:13px;line-height:1.6;margin:0;padding:32px}
                    h1{font-size:22px;font-weight:700;letter-spacing:-0.01em;margin:0 0 4px}
                    .meta{font-size:10px;color:#64748b;font-family:"JetBrains Mono",monospace;margin-bottom:24px}
                    .body{font-size:13px;line-height:1.7}
                    .body p{margin:0 0 12px}
                    .body strong{font-weight:600}
                    .body ol, .body ul{margin:0 0 12px;padding-left:24px}
                    .signed-block{margin-top:48px;padding-top:24px;border-top:1px solid #e2e8f0}
                    .signed-block-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:12px}
                    .sig-row{display:flex;align-items:flex-end;gap:32px;margin-top:8px}
                    .sig-row > div:first-child{flex:1}
                    .sig-img{height:80px;max-width:240px;border-bottom:1px solid #94a3b8;display:block;margin-bottom:6px}
                    .sig-name{font-size:13px;font-weight:600}
                    .sig-meta{font-size:10px;color:#64748b;font-family:"JetBrains Mono",monospace}
                    .footer{margin-top:48px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8;font-family:"JetBrains Mono",monospace}
                    @media print{body{padding:0}}
                `}} />
            </head>
            <body>
                <h1>{props.agreementName}</h1>
                <div class="meta">Envelope ID: {props.envelopeId}</div>

                <div class="body" dangerouslySetInnerHTML={{ __html: props.bodyHtml }} />

                <div class="signed-block">
                    <div class="signed-block-label">Signed by</div>
                    <div class="sig-row">
                        <div>
                            {sigSrc
                                ? <img class="sig-img" src={sigSrc} alt="Signature" />
                                : <div class="sig-img" style="background:#f1f5f9"></div>
                            }
                            <div class="sig-name">{props.clientName ?? props.clientEmail}</div>
                            <div class="sig-meta">{props.clientEmail}</div>
                        </div>
                        <div>
                            <div class="signed-block-label">Date signed (UTC)</div>
                            <div class="sig-name">{props.signedAtUtcIso ?? '—'}</div>
                        </div>
                    </div>
                </div>

                <div class="footer">
                    This document constitutes a binding electronic agreement under the United States Electronic
                    Signatures in Global and National Commerce Act (15 U.S.C. § 7001 et seq.) and the Uniform
                    Electronic Transactions Act (UETA). Independent verification: see Certificate of Completion.
                </div>
            </body>
        </html>
    );
}
