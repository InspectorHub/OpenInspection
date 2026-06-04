import { getDescriptor } from './registry';
import { interpolate, escapeHtml } from './interpolate';
import { EmailLayout } from './layout';
import type { TemplateBrand, RenderResult, EmailTemplateDescriptor, TemplateOverride } from './types';

export interface RendererConfig {
  tenantBrand: TemplateBrand;
  platformBrand: TemplateBrand;
  overrides?: Map<string, TemplateOverride>;
}

/** @deprecated Use RendererConfig */
export type RendererBrands = RendererConfig;

/**
 * Email-template renderer — renders a trigger to { subject, html, enabled }
 * merging per-tenant overrides (Phase 3) over registry defaults (Phase 2).
 */
export class EmailTemplateRenderer {
  constructor(private config: RendererConfig) {}

  render(trigger: string, data: Record<string, unknown>, opts?: { signatureHtml?: string }): RenderResult {
    const d = getDescriptor(trigger);
    if (!d) throw new Error(`Unknown email template trigger: ${trigger}`);

    const override = this.config.overrides?.get(trigger);
    const enabled = d.required ? true : (override?.enabled ?? true);
    if (!enabled) return { subject: '', html: '', enabled: false };

    const allowed = d.variables.map(v => v.name);
    const resolve = (s: string) => interpolate(s, data, allowed);

    const subjectTemplate = override?.subject ?? d.defaultSubject;
    const blockValueDefault = (b: { key: string; default: string }) => override?.blocks?.[b.key] ?? b.default;

    const subject = unescapeEntities(resolve(subjectTemplate));
    const blockValues = new Map(d.blocks.map(b => [b.key, resolve(blockValueDefault(b))]));

    const heading = blockValues.get('heading') ?? '';
    const ctaLabelKey = d.cta?.labelBlockKey;
    const paragraphs = d.blocks
      .filter(b => b.key !== 'heading' && b.key !== ctaLabelKey)
      .map(b => blockValues.get(b.key) ?? '');

    let cta: { label: string; url: string } | undefined;
    if (d.cta) {
      const label = blockValues.get(d.cta.labelBlockKey) ?? '';
      const url = escapeHtml(String(data[d.cta.urlVar] ?? ''));
      if (url) cta = { label, url };
    }

    const brand = d.brand === 'platform' ? this.config.platformBrand : this.config.tenantBrand;
    const systemHtml = this.buildSystemBlocks(d, data);

    const html = EmailLayout({
      brand,
      heading,
      paragraphs,
      ...(cta ? { cta } : {}),
      ...(systemHtml !== undefined ? { systemHtml } : {}),
      ...(opts?.signatureHtml ? { signatureHtml: opts.signatureHtml } : {}),
    });
    return { subject, html, enabled: true };
  }

  private buildSystemBlocks(d: EmailTemplateDescriptor, data: Record<string, unknown>): string | undefined {
    if (!d.systemBlocks?.length) return undefined;
    const esc = (v: unknown) => escapeHtml(String(v ?? ''));
    const parts: string[] = [];
    for (const kind of d.systemBlocks) {
      if (kind === 'auditMetadata') {
        parts.push(`<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;margin:8px 0;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#94a3b8;line-height:1.6;">Signed: ${esc(data.signedAtUtc)}<br>IP: ${esc(data.ipAddress) || 'recorded'}<br>Confirmation: ${esc(data.confirmationId)}</div>`);
      } else if (kind === 'attachmentManifest') {
        parts.push(`<p style="margin:8px 0;font-size:13px;color:#64748b;">The full document is attached to this email.</p>`);
      } else if (kind === 'icsHint') {
        if (!data.icsAttached) continue;
        parts.push(`<p style="margin:8px 0;font-size:13px;color:#64748b;">A calendar invite (<strong>inspection.ics</strong>) is attached — open it to add this to your calendar.</p>`);
      }
    }
    return parts.join('\n');
  }
}

/** Reverse the HTML-entity encoding interpolate() added, so the subject is plain text (not entity-encoded). */
function unescapeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
