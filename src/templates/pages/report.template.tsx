import { BareLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';
import { ReportSidebar, type ReportSidebarSection } from '../components/report-sidebar';
import { ReportTabBar } from '../components/report-tab-bar';
import { ShareDropdown } from '../components/share-dropdown';
import { PdfDropdown } from '../components/pdf-dropdown';
import { ReportStatusPill } from '../components/report-status-pill';

interface InspectionRecord { id: string; propertyAddress: string; clientName?: string | null; clientEmail?: string | null; date: string; price: number; paymentStatus: string; signed?: boolean; status?: string | null; }
interface TemplateRecord { schema: string | Record<string, unknown>; }
interface SchemaItemRaw { id: string; label?: string; name?: string; type?: string; options?: { unit?: string; choices?: string[] } | undefined; }
interface SchemaSectionRaw { title?: string; name?: string; items: SchemaItemRaw[]; }
interface SchemaItem { id: string; label: string; type?: string; options?: { unit?: string; choices?: string[] } | undefined; }
interface SchemaSection { id: string; title: string; items: SchemaItem[]; }
interface ResultItem { rating?: string; status?: string; notes?: string; photos?: { key: string }[]; value?: unknown; }
interface RatingLevel { id: string; label: string; abbreviation?: string; color: string; severity: string; isDefect: boolean; }

/**
 * Sprint 1 Sub-spec D — derive a stable, slug-like id from a section title so
 * the sidebar nav anchors and the section <section id> stay in sync.
 */
function slugifySectionId(title: string, index: number): string {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return slug || `section-${index}`;
}

export function renderProfessionalReport(data: {
    inspection: InspectionRecord,
    template: TemplateRecord,
    results: { data: Record<string, ResultItem> } | undefined,
    branding?: BrandingConfig | undefined,
    isAuthenticated?: boolean | undefined,
    resolvedTheme?: 'modern' | 'classic' | 'minimal' | undefined
}): JSX.Element {
    const { inspection, template, results, branding } = data;
    const isAuthenticated = data.isAuthenticated ?? false;
    const resolvedTheme: 'modern' | 'classic' | 'minimal' = data.resolvedTheme || 'modern';
    const siteName = branding?.siteName || 'OpenInspection';
    const logoUrl = branding?.logoUrl;
    const rawSchema = typeof template.schema === 'string' ? JSON.parse(template.schema) as { sections: SchemaSectionRaw[]; ratingSystem?: { levels: RatingLevel[] } } : template.schema as { sections: SchemaSectionRaw[]; ratingSystem?: { levels: RatingLevel[] } };
    // Normalize field names: DB may have "name" but templates use "title"/"label"
    const schema: { sections: SchemaSection[] } = {
        sections: (rawSchema.sections || []).map((sec: SchemaSectionRaw, idx: number) => {
            const title = sec.title || sec.name || 'Untitled';
            return {
                id: slugifySectionId(title, idx),
                title,
                items: (sec.items || []).map((item: SchemaItemRaw) => {
                    const out: SchemaItem = {
                        id: item.id,
                        label: item.label || item.name || 'Untitled',
                    };
                    if (item.type)    out.type    = item.type;
                    if (item.options) out.options = item.options;
                    return out;
                }),
            };
        }),
    };
    const ratingLevels: RatingLevel[] = rawSchema.ratingSystem?.levels || [
        { id: 'Satisfactory', label: 'Satisfactory', color: '#22c55e', severity: 'good', isDefect: false },
        { id: 'Monitor', label: 'Monitor', color: '#f59e0b', severity: 'marginal', isDefect: false },
        { id: 'Defect', label: 'Defect', color: '#ef4444', severity: 'significant', isDefect: true },
    ];
    const levelMap = new Map(ratingLevels.map(l => [l.id, l]));

    // Resolve a rating ID to its severity bucket
    const resolveSeverity = (ratingId: string | undefined): 'good' | 'marginal' | 'defect' | null => {
        if (!ratingId) return null;
        const level = levelMap.get(ratingId);
        if (level) {
            if (level.isDefect || level.severity === 'significant') return 'defect';
            if (level.severity === 'marginal') return 'marginal';
            if (level.severity === 'good') return 'good';
        }
        // Legacy fallback: full string IDs
        if (ratingId === 'Satisfactory') return 'good';
        if (ratingId === 'Monitor') return 'marginal';
        if (ratingId === 'Defect') return 'defect';
        return null;
    };

    const resultData = results?.data || {};

    const stats = {
        satisfactory: 0,
        monitor: 0,
        defect: 0,
        total: 0
    };

    // Sub-spec D — per-section defect counts power the sidebar badges.
    // The current rendering pipeline only carries a single severity bucket
    // per item (good/marginal/defect); we surface defects as the
    // `recommendation` category, marginal/monitor as `maintenance`, and
    // leave `safety` at zero because per-item safety classification lives
    // on the v2 defect tabs which aren't part of this template render path.
    const sectionDefects = new Map<string, { safety: number; recommendation: number; maintenance: number }>();

    schema.sections.forEach((s: SchemaSection) => {
        const counts = { safety: 0, recommendation: 0, maintenance: 0 };
        s.items.forEach((i: SchemaItem) => {
            const res = resultData[i.id];
            const ratingId = res?.rating || res?.status;
            const bucket = resolveSeverity(ratingId);
            if (bucket === 'good') stats.satisfactory++;
            if (bucket === 'marginal') { stats.monitor++; counts.maintenance++; }
            if (bucket === 'defect')   { stats.defect++;  counts.recommendation++; }
            stats.total++;
        });
        sectionDefects.set(s.id, counts);
    });

    // Sidebar payload (Sub-spec D Task 1) — compact section list with
    // pre-computed defect badges.
    const sidebarSections: ReportSidebarSection[] = schema.sections.map((s) => ({
        id: s.id,
        title: s.title,
        defects: sectionDefects.get(s.id) ?? { safety: 0, recommendation: 0, maintenance: 0 },
    }));

    // Aggregate defect counts feed the tab bar pill (Sub-spec D Task 2).
    const aggregateDefects = sidebarSections.reduce(
        (acc, s) => ({
            safety:         acc.safety         + s.defects.safety,
            recommendation: acc.recommendation + s.defects.recommendation,
            maintenance:    acc.maintenance    + s.defects.maintenance,
        }),
        { safety: 0, recommendation: 0, maintenance: 0 },
    );

    // Resolve viewer role from auth state. Inspector role unlocks edit/publish
    // actions in the sidebar; agent / client view is read-only.
    const viewerRole: 'inspector' | 'agent' | 'client' = isAuthenticated ? 'inspector' : 'client';
    const reportStatus = (inspection.status as string | undefined) || 'draft';

    return BareLayout({
        title: `Inspection Report - ${inspection.propertyAddress}`,
        branding,
        dataTheme: resolvedTheme,
        extraHead: (
            <>
                <link rel="stylesheet" href="/css/report-themes.css" />
                <script defer src="/vendor/alpine.min.js">{''}</script>
                <script src="/js/signature_pad.umd.min.js">{''}</script>
            </>
        ),
        children: (
<div
    x-data={`reportViewer(${JSON.stringify({
        inspection: { id: inspection.id, propertyAddress: inspection.propertyAddress },
        sections: sidebarSections.map(s => ({ id: s.id, title: s.title })),
        role: viewerRole,
        tab: 'full',
    })})`}
    x-init="init()"
    class="min-h-screen bg-slate-50/50 antialiased relative"
>
    {/* Sub-spec D Task 5 — left sidebar, hidden in print. */}
    <ReportSidebar
        sections={sidebarSections}
        role={viewerRole}
        inspectionId={inspection.id}
        siteName={siteName}
        {...(logoUrl ? { brandLogo: logoUrl } : {})}
    />

    {/* Sub-spec D Task 5 — top action bar + tab bar (Share / PDF / status pill).
        Sticky at top in screen view; entirely removed for print via print:hidden. */}
    <header class="lg:ml-60 bg-white border-b border-slate-200 sticky top-0 z-20 print:hidden">
        <div class="px-6 py-3 flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
                <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Inspection Report</p>
                <h1 class="text-[18px] font-semibold tracking-tight text-slate-900 truncate">{inspection.propertyAddress}</h1>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
                <ReportStatusPill status={reportStatus} />
                <ShareDropdown />
                <PdfDropdown />
            </div>
        </div>
        <ReportTabBar defectCounts={aggregateDefects} />
    </header>

    <div
        x-data={`reportGatekeeper('${inspection.id}')`}
        class="lg:ml-60 px-6 py-6 print:ml-0 print:px-0 print:py-0"
    >
    {/* Spec 5F R2 Step 6 — atmospheric blobs removed (audit P1-4). */}

    <div
        {...{':class': "(showAgreement || (signed && showPayment && !paid)) ? 'blur-content' : ''"}}
        class="max-w-6xl mx-auto relative z-10"
    >
        <div class="bg-white shadow-[0_40px_100px_-20px_rgba(0,0,0,0.08)] rounded-xl overflow-hidden border border-white relative">
            {/* Header / Cover Tier */}
            <div class="bg-slate-900 px-6 py-8 md:px-10 md:py-10 relative overflow-hidden">
                <div class="absolute top-0 right-0 w-[400px] h-full bg-gradient-to-l from-indigo-500/20 to-transparent skew-x-[-20deg] translate-x-32"></div>
                
                <div class="relative z-10 flex flex-col md:flex-row justify-between items-end gap-6">
                    <div class="max-w-3xl">
                        <div class="flex items-center gap-4 mb-6">
                            <div class="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-2xl p-1">
                                <img src={logoUrl || '/logo.svg'} alt={siteName} class="w-full h-full object-contain" />
                            </div>
                            <div class="h-8 w-px bg-white/20"></div>
                            <span class="text-[10px] font-bold uppercase tracking-[0.3em] text-white/60">Inspection Report</span>
                        </div>
                        {/* Spec 5F.2 — Cover H1 sized to v3 (--ih-text-hero 40px ≈ text-4xl).
                            Per handoff README, font-black is retained ONLY on Report Cover H1
                            + stat numbers; the size moved from text-7xl (72px) → text-4xl
                            (36px), still hero-scale but no longer Spectora-mockingly oversized. */}
                        <h1 class="text-3xl md:text-2xl font-bold tracking-tight text-white leading-[1.1]">{inspection.propertyAddress}</h1>
                        <p class="mt-8 text-xl text-slate-400 font-medium tracking-tight">Home Inspection Report</p>
                    </div>
                    
                    <div class="flex flex-col items-start md:items-end gap-2 border-l-2 md:border-l-0 md:border-r-2 border-indigo-500/40 pl-8 md:pl-0 md:pr-8 py-2">
                        <span class="text-[10px] font-bold uppercase tracking-[0.3em] text-indigo-400">Inspection Date</span>
                        <span class="text-xl font-bold text-white tabular-nums tracking-tight">
                            {new Date(inspection.date).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase()}
                        </span>
                    </div>
                </div>
            </div>

            {/* AI Intelligence Synthesis Tier */}
            <template x-if="paid && aiSummary">
                <div class="px-12 py-6 bg-white relative no-print overflow-hidden group">
                    <div class="absolute inset-0 bg-indigo-600/[0.02] transition-colors group-hover:bg-indigo-600/[0.04]"></div>
                    <div class="relative z-10 flex items-start gap-4">
                        <div class="flex-shrink-0 w-16 h-16 bg-white border border-indigo-100 rounded-lg flex items-center justify-center shadow-md/30">
                             <svg class="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                        </div>
                        <div>
                            <div class="flex items-center gap-3 mb-3">
                                <h3 class="text-indigo-900 font-extrabold text-2xl tracking-tight">AI Summary</h3>
                                <span class="bg-indigo-600 text-white text-[9px] font-bold uppercase tracking-[0.2em] px-3 py-1 rounded-full shadow-lg shadow-indigo-100">Certified AI</span>
                            </div>
                            <p class="text-indigo-900/60 leading-[1.8] text-lg font-medium italic max-w-4xl" x-text="aiSummary"></p>
                        </div>
                    </div>
                    <div class="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-indigo-100 to-transparent"></div>
                </div>
            </template>

            {/* Technical Overview Tier */}
            <div class="px-12 py-10 grid grid-cols-1 md:grid-cols-4 gap-6 bg-slate-50/30 relative">
                <div class="md:col-span-1">
                    <div class="flex items-center gap-2 mb-8">
                        <div class="w-1.5 h-6 bg-indigo-600 rounded-full"></div>
                        <h3 class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Summary</h3>
                    </div>
                    <div class="space-y-6">
                        <div class="flex justify-between items-end">
                            <span class="text-sm font-bold text-slate-400 uppercase tracking-widest">Satisfactory</span>
                            <span class="text-xl font-bold text-emerald-600 tabular-nums leading-none">{stats.satisfactory}</span>
                        </div>
                        <div class="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div class="h-full bg-emerald-500 rounded-full" style={`width: ${stats.total ? (stats.satisfactory/stats.total)*100 : 0}%`}></div>
                        </div>
                        
                        <div class="flex justify-between items-end pt-2">
                            <span class="text-sm font-bold text-slate-400 uppercase tracking-widest">Monitor</span>
                            <span class="text-xl font-bold text-amber-600 tabular-nums leading-none">{stats.monitor}</span>
                        </div>
                        <div class="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div class="h-full bg-amber-500 rounded-full" style={`width: ${stats.total ? (stats.monitor/stats.total)*100 : 0}%`}></div>
                        </div>

                        <div class="flex justify-between items-end pt-2">
                            <span class="text-sm font-bold text-slate-400 uppercase tracking-widest">Deficient</span>
                            <span class="text-xl font-bold text-rose-600 tabular-nums leading-none">{stats.defect}</span>
                        </div>
                        <div class="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div class="h-full bg-rose-500 rounded-full" style={`width: ${stats.total ? (stats.defect/stats.total)*100 : 0}%`}></div>
                        </div>
                    </div>
                </div>
                
                <div class="md:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-16 md:pl-16 border-l border-slate-100">
                   <div>
                       <div class="flex items-center gap-2 mb-8">
                           <div class="w-1.5 h-6 bg-slate-900 rounded-full"></div>
                           <h3 class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Client</h3>
                       </div>
                       <p class="text-xl font-bold tracking-tight text-slate-900">{inspection.clientName || 'Private Client'}</p>
                       <p class="mt-2 text-lg text-indigo-600 font-bold uppercase tracking-tight">{inspection.clientEmail || 'REDACTED'}</p>
                       <div class="mt-6 pt-6 border-t border-slate-100 flex gap-4">
                           <div class="px-3 py-1 bg-slate-100 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-500">Standard Inspection</div>
                       </div>
                   </div>
                   <div>
                       <div class="flex items-center gap-2 mb-8">
                           <div class="w-1.5 h-6 bg-indigo-600 rounded-full"></div>
                           <h3 class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Inspector</h3>
                       </div>
                       <p class="text-xl font-bold tracking-tight text-slate-900">{branding?.siteName || siteName}</p>
                       <p class="mt-2 text-lg text-slate-500 font-medium">Report #{inspection.id.substring(0, 8).toUpperCase()}</p>
                       <div class="mt-6 flex items-center gap-3">
                           <div class="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
                               <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                           </div>
                           <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-600">Licensed Inspector</span>
                       </div>
                   </div>
                </div>
            </div>

            {/* Inspection Details */}
            <div class="px-6 py-10 md:px-10 md:py-12 space-y-10 bg-white">
                {/* Spec 5F.9 — section + item wrappers gain report-pdf-* classes
                    that ONLY apply in @media print (defined in input.css). On
                    screen, no styling change. In PDF render, sections collapse
                    to a 2-col grid with hairline borders; defect items break
                    back to full-row red bg; photos shrink to 4-col mini grid
                    capped at 8 per item. */}
                {schema.sections.map((section: SchemaSection) => {
                    const sectionCounts = sectionDefects.get(section.id) ?? { safety: 0, recommendation: 0, maintenance: 0 };
                    return (
                    <section
                        class="page-break report-pdf-section report-section"
                        id={`section-${section.id}`}
                        key={section.id}
                        data-defect-safety={sectionCounts.safety > 0 ? '1' : '0'}
                    >
                        <div class="flex items-center gap-4 mb-16">
                            <h2 class="text-3xl font-bold tracking-tight text-slate-900 shrink-0">{section.title}</h2>
                            <div class="flex-grow h-0.5 bg-gradient-to-r from-slate-100 to-transparent"></div>
                            <span class="text-[10px] font-bold uppercase tracking-[0.4em] text-slate-300">Section {schema.sections.indexOf(section) + 1}</span>
                        </div>

                        <div class="space-y-6 report-pdf-grid">
                            {section.items.map((item: SchemaItem) => {
                                const res: ResultItem = resultData[item.id] || {};
                                const itemRatingId = res.rating || res.status;
                                const bucket = resolveSeverity(itemRatingId);
                                const level = itemRatingId ? levelMap.get(itemRatingId) : undefined;
                                const displayLabel = level?.label || itemRatingId || 'NO DATA';
                                const itemClass = bucket === 'defect' ? 'report-pdf-item report-pdf-item--defect' : 'report-pdf-item';
                                const photos = res.photos || [];
                                const photoCap = 8;

                                // Sub-spec D Task 5 — collapse empty items: no rating + only the
                                // "No notes recorded." placeholder + no photos. These are dead
                                // weight in the report and clutter the Summary view.
                                const hasRating = !!itemRatingId;
                                const hasNotes  = !!(res.notes && res.notes !== 'No notes recorded.');
                                const hasPhotos = photos.length > 0;
                                if (!hasRating && !hasNotes && !hasPhotos) return null;

                                // Defect category mapping (Sub-spec D Task 2 / 5):
                                // bucket=defect   -> recommendation (per render-path heuristic)
                                // bucket=marginal -> maintenance
                                // bucket=good/null -> none
                                const itemDefectCount = bucket === 'defect' ? 1 : bucket === 'marginal' ? 1 : 0;
                                // Per-render-path: safety category isn't classified at item level
                                // here (only the v2 defect-tabs path has that data). Mirror the
                                // section-level zero so the print filter behaves consistently.
                                const itemSafetyFlag  = '0';

                                return (
                                    <div
                                        class={`flex flex-col lg:flex-row gap-16 avoid-break group report-item ${itemClass}`}
                                        key={item.id}
                                        data-defects={String(itemDefectCount)}
                                        data-defect-safety={itemSafetyFlag}
                                    >
                                        <div class="flex-grow">
                                            <div class="flex justify-between items-start gap-4 mb-6">
                                                <h3 class="text-xl font-bold tracking-tight text-slate-900 group-hover:text-indigo-600 transition-colors">{item.label}</h3>
                                                <span class={`ih-pill ${bucket === 'good' ? 'ih-pill--sat' : bucket === 'marginal' ? 'ih-pill--monitor' : bucket === 'defect' ? 'ih-pill--defect' : 'ih-pill--gen'}`}>{displayLabel}</span>
                                            </div>
                                            {/* Non-rich item value — boolean/number/text/textarea/date/select/
                                                multi_select store the captured value on res.value. The customer-
                                                facing report viewer surfaces it inline so the inspector's entry
                                                isn't silently hidden behind a rating pill that doesn't apply. */}
                                            {item.type && item.type !== 'rich' && (res as { value?: unknown }).value !== undefined && (res as { value?: unknown }).value !== '' && (res as { value?: unknown }).value !== null && (
                                                <p class="text-lg text-slate-700 font-semibold mb-3 item-value">
                                                    <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mr-3">{item.type}</span>
                                                    {Array.isArray((res as { value?: unknown }).value)
                                                        ? ((res as { value: unknown[] }).value).join(' · ')
                                                        : (item.type === 'boolean'
                                                            ? ((res as { value: boolean }).value ? 'Yes' : 'No')
                                                            : String((res as { value: unknown }).value))}
                                                    {item.options?.unit ? <span class="text-slate-400 ml-2">{item.options.unit}</span> : null}
                                                </p>
                                            )}
                                            <p class="text-xl text-slate-500 leading-relaxed font-medium max-w-3xl item-notes">{res.notes || 'No notes recorded.'}</p>
                                        </div>

                                        {/* High-Resolution Evidence Architecture */}
                                        {photos.length > 0 ? (
                                            <div class="lg:w-[480px] shrink-0 grid grid-cols-2 gap-4 avoid-break report-pdf-photos">
                                                {photos.slice(0, photoCap).map((p: { key: string }) => (
                                                    <div class="aspect-square bg-slate-50 rounded-lg overflow-hidden border-4 border-white shadow-md/20 group/photo transition-transform hover:scale-[1.02]" key={p.key}>
                                                        <img src={`/api/inspections/files/${p.key}`} class="w-full h-full object-cover grayscale-[0.2] transition-all group-hover/photo:grayscale-0" />
                                                    </div>
                                                ))}
                                                {photos.length > photoCap && (
                                                    <div class="hidden print:block col-span-full text-[8pt] text-slate-400 italic">+{photos.length - photoCap} more in web report</div>
                                                )}
                                            </div>
                                        ) : (
                                            <div class="lg:w-[480px] shrink-0 h-40 border-2 border-dashed border-slate-50 rounded-lg flex items-center justify-center grayscale opacity-20">
                                                <span class="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-300">No photos</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                    );
                })}
            </div>

            {/* Document Finalization Tier */}
            <div class="bg-slate-900 p-8 md:p-12 text-center relative overflow-hidden no-print">
                <div class="absolute inset-0 bg-indigo-600/10 mix-blend-overlay"></div>
                <div class="relative z-10 max-w-3xl mx-auto">
                    <div class="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-6 text-white">
                        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                    </div>
                    <h2 class="text-2xl font-bold tracking-tight text-white mb-6">Report Complete</h2>
                    <p class="text-indigo-200/60 text-lg font-medium mb-6 uppercase tracking-[0.2em] leading-relaxed">This report documents the condition of the property at the time of inspection.</p>
                    
                    <div class="flex flex-col sm:flex-row justify-center gap-6">
                        <button onclick="window.print()" class="px-12 py-5 bg-white text-slate-900 rounded-2xl text-sm font-bold uppercase tracking-[0.2em] shadow-2xl hover:bg-slate-50 active:scale-95 transition-all">Print / Save PDF</button>
                        <a href="/dashboard" class="px-12 py-5 bg-white/10 text-white border border-white/20 rounded-2xl text-sm font-bold uppercase tracking-[0.2em] backdrop-blur-md hover:bg-white/20 active:scale-95 transition-all">Back to Dashboard</a>
                    </div>
                </div>
            </div>
        </div>

        <div class="text-center mt-12 text-slate-400 text-[10px] font-bold uppercase tracking-[0.4em] no-print opacity-40">
            &copy; {new Date().getFullYear()} {siteName}. All rights reserved.
        </div>
    </div>

    {/* Precision Interaction FAB */}
    <button onclick="window.print()" class="fixed bottom-12 right-12 no-print bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-2xl shadow-indigo-300 w-20 h-20 flex items-center justify-center transition-all hover:scale-110 active:scale-95 group z-[200]" title="Export to PDF">
        <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
    </button>

    {/* Report Paywall Gate */}
    <template x-if="showAgreement">
        <div class="fixed inset-0 z-[500] flex items-center justify-center p-6 bg-slate-950/95 backdrop-blur-2xl">
            <div class="bg-white rounded-2xl shadow-[0_60px_120px_-20px_rgba(0,0,0,0.6)] max-w-3xl w-full p-16 space-y-12 animate-slide-in">
                <div class="text-center">
                    <div class="w-20 h-20 bg-indigo-600 rounded-lg flex items-center justify-center mx-auto mb-8 shadow-md">
                        <svg class="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    </div>
                    <h2 class="text-3xl font-bold tracking-tight text-slate-900 mb-4">Agreement Review</h2>
                    <p class="text-xl text-slate-400 font-medium">Authentication required. Please authorize the inspection terms of service.</p>
                </div>

                <div class="prose prose-indigo prose-lg max-h-80 overflow-y-auto p-6 bg-slate-50/50 rounded-xl border border-slate-100 text-slate-600 leading-relaxed font-medium shadow-inner" x-html="agreementContent"></div>

                <div class="space-y-6">
                    <div class="flex justify-between items-end">
                        <h4 class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em]">Electronic Signature Authorization</h4>
                        <button {...{'@click': 'clearSignature'}} class="text-[10px] font-bold text-rose-500 hover:text-rose-600 uppercase tracking-[0.2em] transition-colors">Reset Input</button>
                    </div>
                    <div class="bg-slate-50 border-2 border-slate-100 rounded-lg overflow-hidden group focus-within:border-indigo-600 transition-all shadow-sm">
                        <canvas x-ref="canvas" class="w-full h-48 cursor-crosshair touch-none"></canvas>
                    </div>
                </div>

                <p x-show="signError" x-text="signError" class="text-red-500 text-sm font-semibold text-center mb-3"></p>
                <button {...{'@click': 'submitSignature'}} class="premium-button w-full py-6 bg-slate-900 text-white rounded-lg text-lg font-black tracking-tight shadow-2xl hover:bg-black transition-all flex items-center justify-center gap-4 group">
                    <span>Accept and View Report</span>
                    <svg class="w-6 h-6 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                </button>
            </div>
        </div>
    </template>

    <template x-if="signed && showPayment && !paid">
        <div class="fixed inset-0 z-[500] flex items-center justify-center p-6 bg-slate-950/95 backdrop-blur-2xl">
            <div class="bg-white rounded-2xl shadow-[0_60px_120px_-20px_rgba(0,0,0,0.6)] max-w-xl w-full p-16 text-center space-y-12 animate-slide-in">
                <div class="w-24 h-24 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center mx-auto shadow-md/50">
                    <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>
                </div>
                <div>
                    <h2 class="text-3xl font-bold tracking-tight text-slate-900 mb-4">Payment Required</h2>
                    <p class="text-xl text-slate-400 font-medium leading-relaxed">
                        Your inspection is complete. The balance due is 
                        <span class="text-slate-900 font-black tabular-nums tracking-tight">{`$${(inspection.price / 100).toFixed(2)}`}</span>.
                    </p>
                </div>

                <button {...{'@click': 'redirectToCheckout'}} class="premium-button w-full py-6 bg-indigo-600 text-white rounded-xl text-lg font-black tracking-tight shadow-md hover:bg-indigo-700 active:scale-95 transition-all">
                    Pay to View Report
                </button>

                <div class="flex flex-col items-center gap-4 opacity-40">
                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em]">Secure Payment via Stripe</p>
                    <div class="flex gap-4 grayscale opacity-50 scale-75">
                        {/* Fake logos or symbols for visual gravity */}
                        <div class="w-12 h-6 bg-slate-200 rounded"></div>
                        <div class="w-12 h-6 bg-slate-200 rounded"></div>
                        <div class="w-12 h-6 bg-slate-200 rounded"></div>
                    </div>
                </div>
            </div>
        </div>
    </template>

    <script dangerouslySetInnerHTML={{ __html: `
        document.addEventListener('alpine:init', () => {
            const urlParams = new URLSearchParams(window.location.search);
            const paymentSuccess = urlParams.get('payment') === 'success';

            Alpine.data('reportGatekeeper', (id) => ({
                id,
                signed: ${!!inspection.signed} || ${isAuthenticated},
                paid: ${inspection.paymentStatus === 'paid'} || paymentSuccess || ${isAuthenticated},
                showAgreement: !${!!inspection.signed} && !${isAuthenticated},
                showPayment: !(${inspection.paymentStatus === 'paid'} || paymentSuccess || ${isAuthenticated}),
                hasAgreement: true,
                agreementContent: '',
                aiSummary: '',
                signaturePad: null,
                signError: '',

                async init() {
                    try {
                        const res = await fetch(\`/api/inspections/\${this.id}/agreement\`);
                        if (!res.ok) {
                            this.hasAgreement = false;
                            this.agreementContent = '';
                            this.showAgreement = false;
                            this.signed = true;
                            return;
                        }
                        const data = await res.json();
                        this.agreementContent = data.agreement?.content || 'Error loading agreement terms.';
                    } catch (e) {
                        console.error('Agreement loading error:', e);
                        this.hasAgreement = false;
                        this.agreementContent = '';
                    }

                    if (this.paid) {
                        this.fetchAiSummary();
                    }

                    if (this.showAgreement) {
                        this.$nextTick(() => {
                            const canvas = this.$refs.canvas;
                            this.signaturePad = new SignaturePad(canvas, {
                                penColor: "rgb(15, 23, 42)"
                            });

                            const ratio = Math.max(window.devicePixelRatio || 1, 1);
                            canvas.width = canvas.offsetWidth * ratio;
                            canvas.height = canvas.offsetHeight * ratio;
                            canvas.getContext("2d").scale(ratio, ratio);
                            this.signaturePad.clear();
                        });
                    }
                },

                clearSignature() { this.signaturePad.clear(); this.signError = ''; },

                async submitSignature() {
                    if (this.signaturePad.isEmpty()) { this.signError = 'Please sign before continuing.'; return; }

                    const res = await fetch(\`/api/inspections/\${this.id}/sign\`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ signatureBase64: this.signaturePad.toDataURL() })
                    });

                    if (res.ok) {
                        this.signed = true;
                        this.showAgreement = false;
                    }
                },

                async redirectToCheckout() {
                    const res = await fetch(\`/api/inspections/\${this.id}/checkout\`, { method: 'POST' });
                    const data = await res.json();
                    window.location.href = data.url;
                },

                async fetchAiSummary() {
                    try {
                        const res = await fetch('/api/ai/auto-summary', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ inspectionId: this.id })
                        });
                        const data = await res.json();
                        this.aiSummary = data.summary || '';
                    } catch (e) {
                        console.error('AI Summary Error:', e);
                    }
                }
            }));
        });
    ` }} />
    </div>

    {/* Sub-spec D Task 1 — Alpine controller for the new sidebar / tabs / dropdowns. */}
    <script src="/js/report-viewer.js"></script>
</div>
        ),
    });
}
