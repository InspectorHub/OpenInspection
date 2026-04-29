// src/templates/pages/report-card-stack.tsx
import { BareLayout } from '../layouts/main-layout';
import { StatsCards } from '../components/stats-cards';
import type { RatingLevel } from '../../lib/report-utils';
import type { BrandingConfig } from '../../types/auth';

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
  const { inspectionId, address, date, inspectorName, theme, stats, sections, branding } = props;

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
            <div class="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-8 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto">
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
              <button x-on:click="showRepairPanel = !showRepairPanel" class="px-4 py-2 text-sm font-semibold rounded-lg text-white flex items-center gap-2 theme-accent">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                Repair Request
              </button>
            </div>
          </div>
          <h1 class="text-4xl sm:text-5xl font-bold theme-font-display leading-tight mb-2">{address}</h1>
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
          {sections.map((section) => (
            <div class="mb-10" x-show={`filter === 'all' || filter === 'summary' || sectionHasDefects('${section.id}')`}>
              <div class="flex items-center gap-3 mb-4">
                <span class="text-2xl">{getSectionIcon(section.title)}</span>
                <h2 class="text-2xl font-bold theme-font-display italic">{section.title}</h2>
                <div class="flex-1 h-px theme-border border-t" />
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
                        <div class="mt-2 flex items-center gap-2">
                          <span class="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 uppercase">
                            Recommend: {item.recommendation}
                          </span>
                          {(item.estimateMin || item.estimateMax) && (
                            <span class="text-xs theme-text-muted">
                              ${item.estimateMin?.toLocaleString() ?? '?'} - ${item.estimateMax?.toLocaleString() ?? '?'}
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
                <span class="text-xs font-mono theme-text-muted" x-show="item.estimateMin || item.estimateMax"
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
