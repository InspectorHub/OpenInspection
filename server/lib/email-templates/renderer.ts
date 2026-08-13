import { getDescriptor } from './registry';
import { interpolate, escapeHtml } from './interpolate';
import { EmailLayout } from './layout';
import { REPORT_VIEW_DISCLOSURE, reportViewObjectionUrl } from '../legal/report-view-disclosure';
import type { TemplateBrand, RenderResult, EmailTemplateDescriptor, TemplateOverride } from './types';

export interface RendererConfig {
  tenantBrand: TemplateBrand;
  platformBrand: TemplateBrand;
  overrides?: Map<string, TemplateOverride>;
}


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
    if (!enabled) return { trigger, subject: '', html: '', enabled: false };

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
      .map(b => nl2br(blockValues.get(b.key) ?? ''));

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
    return { trigger, subject, html, enabled: true };
  }

  private buildSystemBlocks(d: EmailTemplateDescriptor, data: Record<string, unknown>): string | undefined {
    if (!d.systemBlocks?.length) return undefined;
    const esc = (v: unknown) => escapeHtml(String(v ?? ''));
    const parts: string[] = [];
    for (const kind of d.systemBlocks) {
      if (kind === 'auditMetadata') {
        parts.push(`<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;margin:8px 0;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#94a3b8;line-height:1.6;">Signed: ${esc(data.signedAtUtc)}<br>IP: ${esc(data.ipAddress) || 'recorded'}<br>Confirmation: ${esc(data.confirmationId)}</div>`);
      } else if (kind === 'attachmentManifest') {
        parts.push(ATTACHMENT_MANIFEST_HTML);
      } else if (kind === 'icsHint') {
        if (!data.icsAttached) continue;
        parts.push(`<p style="margin:8px 0;font-size:13px;color:#64748b;">A calendar invite (<strong>inspection.ics</strong>) is attached — open it to add this to your calendar.</p>`);
      } else if (kind === 'viewDisclosure') {
        parts.push(viewDisclosureHtml(data.reportUrl));
      }
    }
    return parts.join('\n');
  }
}

const ATTACHMENT_MANIFEST_HTML =
  `<p style="margin:8px 0;font-size:13px;color:#64748b;">The full document is attached to this email.</p>`;

/**
 * The system blocks a report-DELIVERY email owes its recipient, for the one
 * sender that cannot go through `render()`.
 *
 * An automation rule whose `email_template_id` supplies the copy
 * (services/automation/report-email.ts) writes tenant-authored HTML, not
 * descriptor blocks, so there is no descriptor to hang `systemBlocks` off.
 * That path still hands over a report link, which is exactly what condition 4
 * of the LIA binds — so it gets the same two blocks from the same painters
 * rather than a second copy of the words. Adding a third caller of these
 * blocks means adding it HERE, not re-deriving the notice at the call site.
 */
export function reportDeliverySystemBlocks(
  args: { reportUrl: string; hasAttachment: boolean },
): string {
  const parts = [viewDisclosureHtml(args.reportUrl)];
  if (args.hasAttachment) parts.unshift(ATTACHMENT_MANIFEST_HTML);
  return parts.join('\n');
}

/**
 * The Art. 13 notice for the report-view counter — OI #271, LIA conditions 4
 * and 5. The words, the order, and why each sentence is mandatory live in
 * `server/lib/legal/report-view-disclosure.ts`; this function only paints them.
 *
 * The exit degrades to plain words when the message carries no report URL,
 * rather than disappearing. A disclosure that silently loses its objection
 * route is one the assessment does not cover, and "no URL" is a template
 * configuration accident, not a decision to withhold the right.
 */
function viewDisclosureHtml(reportUrl: unknown): string {
  const d = REPORT_VIEW_DISCLOSURE;
  const href = reportViewObjectionUrl(reportUrl);
  const exitTail = href
    ? `<a href="${escapeHtml(href)}" style="color:#334155;">${d.exitLabel}</a>.`
    : `${d.exitLabel}, from the link at the foot of your report.`;
  // `data-disclosure-version` travels with the delivered message so a later
  // rewording cannot re-caption what this recipient actually read.
  return `<div data-disclosure-version="${d.version}" style="margin:16px 0 0 0;padding:12px 16px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b;">`
    + `<strong style="display:block;color:#475569;margin-bottom:4px;">${d.heading}</strong>`
    + `<span>${d.fact} ${d.limit} ${d.exit} ${exitTail}</span>`
    + `</div>`;
}

/**
 * Turn the newlines in a resolved paragraph into line breaks.
 *
 * Every `multiline: true` block invites an author — or a sender writing a note
 * into a form — to press Enter, and HTML would otherwise collapse it. Runs on
 * text `interpolate()` has ALREADY escaped, so the only `<` left is the one
 * added here; no author-supplied markup becomes live.
 */
function nl2br(s: string): string {
  return s.replace(/\r?\n/g, '<br />');
}

/** Reverse the HTML-entity encoding interpolate() added, so the subject is plain text (not entity-encoded). */
function unescapeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
