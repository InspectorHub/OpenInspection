// Sprint 2 S2-5 — Summary sub-page Alpine data factory.
// Loads /api/inspections/:id and renders defects-only summary.

document.addEventListener('alpine:init', () => {
    Alpine.data('inspectionSummaryPage', (inspectionId) => ({
        inspectionId,
        loading: true,
        stats: null,
        sectionsWithDefects: [],
        get totalDefects() {
            if (!this.stats) return 0;
            return (this.stats.safety || 0) + (this.stats.recommendation || 0) + (this.stats.maintenance || 0);
        },

        async load() {
            try {
                const res = await window.authFetch('/api/inspections/' + this.inspectionId);
                if (!res.ok) { this.loading = false; return; }
                const j = await res.json();
                const insp = (j.data && (j.data.inspection || j.data)) || {};
                const tpl = (j.data && (j.data.template || (j.data.inspection && j.data.inspection.templateSnapshot))) || null;
                const results = insp.results || (insp.inspectionResults && insp.inspectionResults.data) || {};

                const schema = (tpl && (tpl.schema || tpl)) || {};
                const sections = Array.isArray(schema.sections) ? schema.sections : [];

                const stats = { safety: 0, recommendation: 0, maintenance: 0 };
                const sectionsAcc = [];
                for (const sec of sections) {
                    const items = Array.isArray(sec.items) ? sec.items : [];
                    const defects = [];
                    for (const item of items) {
                        const r = results[item.id] || {};
                        const tabs = r.tabs || {};
                        const cannedDefects = Array.isArray(tabs.defects) ? tabs.defects : [];
                        for (const d of cannedDefects) {
                            if (!d.included) continue;
                            const cat = (d.category || '').toLowerCase() || 'maintenance';
                            const colorMap = { safety: '#dc2626', recommendation: '#f59e0b', maintenance: '#64748b' };
                            const bucket = cat === 'safety' ? 'safety' : cat === 'recommendation' ? 'recommendation' : 'maintenance';
                            stats[bucket] = (stats[bucket] || 0) + 1;
                            defects.push({
                                id: (item.id || '') + ':' + (d.id || d.cannedId || cannedDefects.indexOf(d)),
                                itemLabel: item.label || 'Item',
                                text: d.title || d.comment || '',
                                bucket,
                                color: colorMap[bucket] || '#cbd5e1',
                            });
                        }
                        const customDefects = (r.customComments && Array.isArray(r.customComments.defects)) ? r.customComments.defects : [];
                        for (const d of customDefects) {
                            if (!d.included) continue;
                            const cat = (d.category || '').toLowerCase() || 'maintenance';
                            const bucket = cat === 'safety' ? 'safety' : cat === 'recommendation' ? 'recommendation' : 'maintenance';
                            const colorMap = { safety: '#dc2626', recommendation: '#f59e0b', maintenance: '#64748b' };
                            stats[bucket] = (stats[bucket] || 0) + 1;
                            defects.push({
                                id: (item.id || '') + ':custom:' + (d.id || customDefects.indexOf(d)),
                                itemLabel: item.label || 'Item',
                                text: d.title || d.comment || '',
                                bucket,
                                color: colorMap[bucket] || '#cbd5e1',
                            });
                        }
                    }
                    if (defects.length > 0) {
                        sectionsAcc.push({
                            id: sec.id,
                            title: sec.title || 'Section',
                            defectCount: defects.length,
                            defects,
                        });
                    }
                }
                this.stats = stats;
                this.sectionsWithDefects = sectionsAcc;
            } catch (e) {
                console.error('summary.load failed', e);
            } finally {
                this.loading = false;
            }
        },
    }));
});
