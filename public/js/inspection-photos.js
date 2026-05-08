// Sprint 2 S2-5 — Photos sub-page Alpine data factory.
// Loads /api/inspections/:id and groups all photos by item.

document.addEventListener('alpine:init', () => {
    Alpine.data('inspectionPhotosPage', (inspectionId) => ({
        inspectionId,
        loading: true,
        sections: [],
        totalPhotos: 0,

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

                let total = 0;
                this.sections = sections.map((sec) => {
                    const items = Array.isArray(sec.items) ? sec.items : [];
                    const itemList = items.map((item) => {
                        const r = results[item.id] || {};
                        const photos = Array.isArray(r.photos) ? r.photos : [];
                        total += photos.length;
                        return { id: item.id, label: item.label || item.title || 'Item', photos };
                    });
                    const photoCount = itemList.reduce((sum, i) => sum + i.photos.length, 0);
                    return { id: sec.id, title: sec.title || sec.label || 'Section', items: itemList, photoCount };
                });
                this.totalPhotos = total;
            } catch (e) {
                console.error('photos.load failed', e);
            } finally {
                this.loading = false;
            }
        },
    }));
});
