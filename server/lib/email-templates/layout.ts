import type { TemplateBrand } from './types';
import { escapeHtml } from './interpolate';

export interface LayoutInput {
  brand: TemplateBrand;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  systemHtml?: string;
  signatureHtml?: string;
}

/**
 * Email-template Phase 2 — the single branded email skeleton (spec §4.2).
 * All textual inputs are pre-resolved + HTML-safe (the renderer interpolated
 * + escaped them). This function only assembles chrome and must NOT re-escape.
 */
export function EmailLayout(input: LayoutInput): string {
  const { brand, heading, paragraphs, cta, systemHtml, signatureHtml } = input;
  const accent = brand.primaryColor || '#F55A1A';
  const header = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" height="32" style="height:32px;display:block;" />`
    : `<span style="font-size:18px;font-weight:700;color:${accent};">${escapeHtml(brand.name)}</span>`;

  const SIG_TOKEN = /\{\{\s*signature\s*\}\}/;
  let signaturePlaced = false;
  const paras = paragraphs
    .map(p => {
      if (signatureHtml && SIG_TOKEN.test(p)) {
        signaturePlaced = true;
        if (p.replace(SIG_TOKEN, '').trim() === '') {
          return signatureHtml; // token on its own line → raw, no <p> wrapper
        }
        const stripped = p.replace(SIG_TOKEN, '').trim();
        return `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#334155;">${stripped}</p>\n${signatureHtml}`;
      }
      return `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#334155;">${p}</p>`;
    })
    .join('\n');

  const ctaHtml = cta
    ? `<div style="margin:24px 0;">
         <a href="${cta.url}" style="display:inline-block;background:${accent};color:#ffffff;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:700;text-decoration:none;">${cta.label}</a>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;">
        <tr><td style="padding:24px 32px 8px 32px;border-bottom:1px solid #f1f5f9;">${header}</td></tr>
        <tr><td style="padding:24px 32px 8px 32px;">
          <h1 style="margin:0 0 12px 0;font-size:19px;font-weight:700;line-height:1.4;color:#0f172a;">${heading}</h1>
          ${paras}
          ${ctaHtml}
          ${systemHtml ?? ''}
        </td></tr>
        ${(signatureHtml && !signaturePlaced) ? `<tr><td style="padding:0 32px 16px 32px;">${signatureHtml}</td></tr>` : ''}
      </table>
      <p style="margin:16px 0 0 0;font-size:11px;color:#94a3b8;">Sent by ${escapeHtml(brand.name)}</p>
    </td></tr>
  </table>
</body>
</html>`;
}
