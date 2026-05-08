// src/templates/pages/report-card-stack.tsx
import { BareLayout } from '../layouts/main-layout';
import { StatsCards } from '../components/stats-cards';
import type { RatingLevel } from '../../lib/report-utils';
import type { BrandingConfig } from '../../types/auth';
import {
  canEditSection,
  formatSectionHeading,
  buildSectionEditHref,
} from '../../lib/report-section-numbering';

interface ReportItem {
  id: string;
  label: string;
  rating: string | null;
  ratingColor: string;
  ratingLabel: string | null;
  severityBucket: string;
  notes: string | null;
  photos: { key: string; url: string }[];
  recommendation?: string | null;
  estimateMin?: number | null;
  estimateMax?: number | null;
}

interface ReportSection {
  id: string;
  title: string;
  icon?: string | null;
  defectCount: number;
  items: ReportItem[];
  // Track E2 (Spectora App.A) — per-section legal disclaimer + force page
  // break. Both are optional; legacy templates render unchanged.
  disclaimerText?: string | null;
  alwaysPageBreak?: boolean;
}

interface ReportPageProps {
  inspectionId: string;
  address: string;
  date: string;
  inspectorName: string | null;
  theme: 'modern' | 'classic' | 'minimal';
  stats: { total: number; satisfactory: number; monitor: number; defect: number };
  sections: ReportSection[];
  ratingLevels: RatingLevel[];
  branding?: BrandingConfig | undefined;
  // Spec 5A.3 — when true, render server-side filtered to defects-only
  // (drops sections with zero defects + drops non-defect items). Used by
  // the PDF renderer (?summary=1) so the captured PDF doesn't depend on
  // Alpine hydration state.
  summaryMode?: boolean;
  // Sprint 2 S2-4 — when true, render the per-defect "Estimated cost:
  // $X – $Y" badge underneath the recommendation pill. Tenant-controlled
  // via Settings → Workspace → Reports.
  showEstimates?: boolean;
  // Competitor parity App.F.4 (Spectora) — JWT role of the user viewing
  // the published report. Drives the EDIT SECTION hover button: only
  // owner / admin / inspector see it; public clients (no token) do not.
  viewerRole?: string | null | undefined;
  // Track E1 (ITB §11) — when true, surface a "View repair list" link in
  // the report header so realtors can jump to the contractor punch-list.
  enableRepairList?: boolean;
}

const SECTION_ICONS: Record<string, string> = {
  roof: '🏠', exterior: '🏗️', electrical: '⚡', plumbing: '🔧',
  hvac: '❄️', interior: '🛋️', structural: '🏛️', appliances: '🔌',
};

function getSectionIcon(title: string): string {
  const key = title.toLowerCase().replace(/[^a-z]/g, '');
  for (const [k, v] of Object.entries(SECTION_ICONS)) {
    if (key.includes(k)) return v;
  }
  return '📋';
}

export function ReportCardStackPage(props: ReportPageProps) {
  const { inspectionId, address, date, inspectorName, theme, stats, branding, summaryMode } = props;
  const showEstimates = props.showEstimates ?? false;
  // Competitor parity App.F.4 — only inspectors / admins / owners see the
  // EDIT SECTION button on hover. Public clients never get a way back into
  // the editor from the published view.
  const showEditAffordance = canEditSection(props.viewerRole ?? null);
  const enableRepairList = props.enableRepairList ?? false;
  // Server-side defect filter for ?summary=1 (PDF Summary mode).
  // Keeps only sections with at least one defect, and within each kept
  // section, only items whose severityBucket maps to defect.
  const sections = summaryMode
    ? props.sections
        .filter(s => s.defectCount > 0)
        .map(s => ({ ...s, items: s.items.filter(i => /defect|safety|major/i.test(i.severityBucket)) }))
    : props.sections;

  return BareLayout({
    title: `Report - ${address}`,
    branding,
    extraHead: (
      <>
        <link rel="stylesheet" href="/css/report-themes.css" />
        <link rel="stylesheet" href="/fonts.css" />
        <script src="/js/signature_pad.umd.min.js">{''}</script>
        <script src="/js/report-client.js">{''}</script>
      </>
    ),
    children: (
      <div
        data-theme={theme}
        class="theme-bg min-h-screen theme-font-body"
        x-data={`reportClient(${JSON.stringify({ inspectionId, stats, sections })})`}
        x-init="init()"
      >
        {/* Agreement Gate Overlay (Spectora-style) */}
        <template x-if="agreementGate && !agreementLoading">
          <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/95 backdrop-blur-sm">
            <div class="bg-slate-900 border border-slate-700 rounded-md max-w-2xl w-full p-8 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <div class="text-center">
                <div class="w-14 h-14 bg-indigo-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <svg class="w-7 h-7 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h2 class="text-2xl font-bold text-white" x-text="agreementName || 'Inspection Agreement'"></h2>
                <p class="text-sm text-slate-400 mt-1">Please review and sign before viewing the report.</p>
              </div>

              <div class="bg-slate-800 rounded-xl p-5 max-h-48 overflow-y-auto text-sm text-slate-300 leading-relaxed border border-slate-700" x-text="agreementContent"></div>

              <div class="space-y-2">
                <div class="flex justify-between items-center">
                  <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your Signature</span>
                  <button x-on:click="clearSignature()" class="text-xs text-rose-400 hover:text-rose-300 font-medium">Clear</button>
                </div>
                <div class="bg-slate-800 border border-slate-600 rounded-xl overflow-hidden">
                  <canvas id="signatureCanvas" class="w-full h-32 cursor-crosshair touch-none"></canvas>
                </div>
              </div>

              <button
                x-on:click="submitSignature()"
                x-bind:disabled="signing"
                class="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <span x-show="!signing">Accept &amp; View Report</span>
                <span x-show="signing">Submitting...</span>
                <svg x-show="!signing" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          </div>
        </template>

        {/* Download PDF — Stage 1 PDF export via browser print dialog.
            Hidden in @media print so it doesn't appear in the output. */}
        <button
            type="button"
            {...{ 'x-on:click': 'window.print()' }}
            class="no-print fixed bottom-6 right-6 z-50 px-5 py-3 rounded-full bg-slate-900 text-white text-xs font-bold uppercase tracking-widest shadow-2xl hover:bg-indigo-600 transition-all flex items-center gap-2"
            aria-label="Download PDF (opens browser print dialog)"
        >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"></path>
            </svg>
            Download PDF
        </button>

        {/* Spec 5A.4 — Cover page (visible only in PDF print render).
            Renders address + date + inspector + a quick stats line on
            the first sheet so the resulting PDF opens with branded info
            instead of dropping straight into the section list. */}
        <div class="print-only print-cover">
            {branding?.logoUrl ? <img src={branding.logoUrl} alt="" style="max-height:80px;margin-bottom:2rem;object-fit:contain" /> : null}
            <div class="cover-eyebrow">{summaryMode ? 'Inspection Summary' : 'Inspection Report'}</div>
            <div class="cover-address">{address}</div>
            <div class="cover-meta">
                <div>Inspected <strong>{date || '—'}</strong></div>
                {inspectorName ? <div>By <strong>{inspectorName}</strong></div> : null}
                <div style="margin-top:1.5rem">
                    <strong>{stats.defect}</strong> defect{stats.defect === 1 ? '' : 's'} ·
                    <strong>{stats.monitor}</strong> monitor item{stats.monitor === 1 ? '' : 's'} ·
                    <strong>{stats.satisfactory}</strong> satisfactory
                </div>
            </div>
        </div>

        {/* Main content — blurred when agreement gate is active */}
        <div {...{':class': "agreementGate && !agreementLoading ? 'blur-sm pointer-events-none select-none' : ''"}}>

        {/* Header */}
        <div class="max-w-4xl mx-auto px-4 sm:px-6 pt-8 pb-6">
          <div class="flex items-start justify-between mb-6">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                <svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <span class="text-xs font-semibold tracking-widest uppercase theme-text-muted">CERTIFIED INSPECTION REPORT</span>
            </div>
            <div class="flex items-center gap-2">
              <button class="px-4 py-2 text-sm font-medium rounded-lg theme-border border theme-text-secondary flex items-center gap-2" onclick="window.print()">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                PDF
              </button>
              {/* Track E1 (ITB §11) — opt-in jump link to the aggregated repair list. */}
              {enableRepairList && (
                <a
                  href={`/inspections/${inspectionId}/repair-list`}
                  data-testid="report-repair-list-link"
                  class="no-print px-4 py-2 text-sm font-medium rounded-lg theme-border border theme-text-secondary flex items-center gap-2 hover:bg-slate-50 transition-colors"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                  View Repair List
                </a>
              )}
              <button x-on:click="showRepairPanel = !showRepairPanel" class="px-4 py-2 text-sm font-semibold rounded-lg text-white flex items-center gap-2 theme-accent">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                Repair Request
              </button>
            </div>
          </div>
          <h1 class="text-2xl sm:text-3xl font-bold theme-font-display leading-tight mb-2">{address}</h1>
          <p class="theme-text-secondary text-sm">{date} · Inspector: {inspectorName || 'N/A'}</p>
        </div>

        {/* Stats */}
        <div class="max-w-4xl mx-auto px-4 sm:px-6 mb-6">
          <StatsCards alpine={true} />
        </div>

        {/* Filter Chips */}
        <div class="max-w-4xl mx-auto px-4 sm:px-6 mb-8">
          <div class="flex gap-2">
            {['all', 'defects', 'summary'].map(f => (
              <button
                x-on:click={`filter = '${f}'`}
                x-bind:class={`filter === '${f}' ? 'theme-accent text-white' : 'theme-border border theme-text-secondary'`}
                class="px-4 py-1.5 text-xs font-semibold rounded-full transition-all"
              >
                {f === 'all' ? 'All' : f === 'defects' ? 'Defects Only' : 'Summary'}
              </button>
            ))}
          </div>
        </div>

        {/* Sections */}
        <div class="max-w-4xl mx-auto px-4 sm:px-6" {...{'x-bind:class': "showRepairPanel ? 'pb-[65vh]' : 'pb-32'"}}>
          {sections.map((section, sectionIdx) => (
            <div
              id={`section-${section.id}`}
              data-testid="report-section"
              class="mb-6 report-section group/section relative"
              {...(section.alwaysPageBreak ? { 'data-page-break': 'always' } : {})}
              x-show={`filter === 'all' || filter === 'summary' || sectionHasDefects('${section.id}')`}
            >
              <div class="flex items-center gap-3 mb-4">
                <span class="text-2xl">{getSectionIcon(section.title)}</span>
                {/* Competitor parity App.F.4 — auto-numbered heading
                    ("3 - Roof"). Index follows visible-section order.
                    aria-label uses the full numbered string so screen
                    readers announce "3 - Roof"; the visual H2 splits
                    the number into its own monospace span for design. */}
                <h2
                  data-testid="report-section-heading"
                  aria-label={formatSectionHeading(section.title, sectionIdx)}
                  class="text-2xl font-bold theme-font-display italic"
                >
                  <span data-testid="report-section-number" class="font-mono not-italic mr-1 theme-text-muted">{sectionIdx + 1} -</span>
                  {section.title}
                </h2>
                <div class="flex-1 h-px theme-border border-t" />
                {/* Competitor parity App.F.4 — EDIT SECTION button surfaces
                    on hover. Inspector / admin / owner only; hidden for
                    public viewers (clients, agents, anonymous). Print
                    output never includes it. Renders as a deep-link to
                    the editor with a #section-{id} fragment so the
                    editor scrolls the right section into view. */}
                {showEditAffordance && (
                  <a
                    href={buildSectionEditHref(inspectionId, section.id)}
                    data-testid="report-section-edit"
                    class="no-print opacity-0 group-hover/section:opacity-100 focus:opacity-100 transition-opacity duration-150 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest theme-border border theme-text-secondary hover:bg-slate-50"
                    aria-label={`Edit ${section.title} section`}
                  >
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit Section
                  </a>
                )}
                <span class="text-xs font-mono theme-text-muted">{section.items.length} items</span>
              </div>

              <div class="space-y-3" x-show="filter !== 'summary'">
                {section.items.map((item) => (
                  <div
                    class="theme-card overflow-hidden"
                    style={`border-left: 4px solid ${item.ratingColor}`}
                    x-show={`filter === 'all' || (filter === 'defects' && isDefectItem('${item.severityBucket}'))`}
                  >
                    <div class="p-4">
                      <div class="flex items-start justify-between mb-2">
                        <h3 class="font-semibold">{item.label}</h3>
                        {item.ratingLabel && (
                          <span
                            class="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide"
                            style={`background: ${item.ratingColor}20; color: ${item.ratingColor}`}
                          >
                            {item.ratingLabel}
                          </span>
                        )}
                      </div>
                      {item.notes && <p class="text-sm theme-text-secondary mt-2 leading-relaxed">{item.notes}</p>}
                      {item.recommendation && (
                        <div class="mt-2 flex items-center gap-2 flex-wrap">
                          <span class="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 uppercase">
                            Recommend: {item.recommendation}
                          </span>
                          {/* Sprint 2 S2-4 — estimate badge is tenant-gated. */}
                          {showEstimates && (item.estimateMin != null || item.estimateMax != null) && (
                            <span
                              data-testid="report-estimate-badge"
                              class="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 tabular-nums"
                            >
                              Estimated cost: ${item.estimateMin?.toLocaleString() ?? '?'} – ${item.estimateMax?.toLocaleString() ?? '?'}
                            </span>
                          )}
                        </div>
                      )}
                      {item.photos.length > 0 && (
                        <div class="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {item.photos.map((photo, idx) => (
                            <img
                              src={photo.url}
                              alt={`${item.label} photo ${idx + 1}`}
                              class="w-full h-32 object-cover cursor-pointer"
                              style="border-radius: var(--radius-btn)"
                              loading="lazy"
                              x-on:click={`openLightbox('${photo.url}')`}
                            />
                          ))}
                        </div>
                      )}
                      {(item.severityBucket === 'defect' || item.severityBucket === 'monitor') && (
                        <label class="flex items-center gap-2 mt-3 cursor-pointer text-sm theme-text-secondary">
                          <input type="checkbox" x-model={`repairItems['${item.id}']`} class="rounded border-gray-300" />
                          Add to repair request
                        </label>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Summary mode */}
              <div x-show="filter === 'summary'" class="theme-card p-4">
                <div class="flex items-center justify-between">
                  <span class="font-medium">{section.items.length} items inspected</span>
                  <span class="text-sm font-semibold" style={`color: ${section.defectCount > 0 ? '#f43f5e' : '#22c55e'}`}>
                    {section.defectCount > 0 ? `${section.defectCount} defect${section.defectCount > 1 ? 's' : ''}` : 'All clear'}
                  </span>
                </div>
              </div>

              {/* Track E2 (Spectora App.A) — per-section disclaimer rendered
                  beneath the items list. Hidden in summary filter to keep the
                  preview pane clean. */}
              {section.disclaimerText && (
                <div
                  data-testid="section-disclaimer"
                  class="mt-4 px-4 py-3 rounded-md border theme-border bg-amber-50/40 text-[12px] leading-relaxed text-slate-700"
                  x-show="filter !== 'summary'"
                >
                  <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-700 mb-1">Disclaimer</div>
                  <p class="whitespace-pre-line">{section.disclaimerText}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Repair Request Panel */}
        <div
          x-show="showRepairPanel"
          x-transition:enter="transition ease-out duration-300"
          x-transition:enter-start="translate-y-full"
          x-transition:enter-end="translate-y-0"
          x-transition:leave="transition ease-in duration-200"
          x-transition:leave-start="translate-y-0"
          x-transition:leave-end="translate-y-full"
          class="fixed bottom-0 left-0 right-0 z-50 theme-card border-t max-h-[60vh] overflow-y-auto"
          style="border-radius: var(--radius-card) var(--radius-card) 0 0"
        >
          <div class="max-w-4xl mx-auto p-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-bold">Repair Request</h3>
              <button x-on:click="showRepairPanel = false" class="theme-text-muted">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div x-show="selectedRepairCount === 0" class="text-center py-8 theme-text-muted">
              <p>No items selected. Check "Add to repair request" on defect cards above.</p>
            </div>
            <template x-for="item in selectedRepairItems" x-bind:key="item.id">
              <div class="flex items-center justify-between py-2 border-b theme-border">
                <div>
                  <span class="font-medium text-sm" x-text="item.label"></span>
                  <span class="text-xs theme-text-muted ml-2" x-show="item.recommendation" x-text="'-- ' + item.recommendation"></span>
                </div>
                <span class="text-xs font-mono theme-text-muted" x-show={`${showEstimates ? 'true' : 'false'} && (item.estimateMin || item.estimateMax)`}
                  x-text="'$' + (item.estimateMin || '?') + ' - $' + (item.estimateMax || '?')"></span>
              </div>
            </template>
            <div x-show="selectedRepairCount > 0" class="mt-4 flex items-center justify-between">
              <div class="text-sm font-semibold">
                <span x-text="selectedRepairCount"></span> items ·
                Estimated: <span x-text="'$' + estimateTotal.min.toLocaleString() + ' - $' + estimateTotal.max.toLocaleString()"></span>
              </div>
              <div class="flex gap-2">
                <button class="px-4 py-2 text-sm font-medium rounded-lg theme-border border" onclick="window.print()">Export PDF</button>
                <button class="px-4 py-2 text-sm font-semibold rounded-lg theme-accent text-white">Send to Inspector</button>
              </div>
            </div>
          </div>
        </div>

        </div>{/* end blur wrapper */}

        {/* Lightbox */}
        <div
          x-show="lightboxUrl"
          x-transition:enter="transition ease-out duration-200"
          x-transition:enter-start="opacity-0"
          x-transition:enter-end="opacity-100"
          x-transition:leave="transition ease-in duration-150"
          x-transition:leave-start="opacity-100"
          x-transition:leave-end="opacity-0"
          class="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
          x-on:click="lightboxUrl = null"
        >
          <img x-bind:src="lightboxUrl" class="max-w-full max-h-[90vh] object-contain rounded-lg" />
        </div>
      </div>
    ),
  });
}
