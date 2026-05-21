// Design-alignment B+C — photo gallery sheet, replacing the retired
// /inspections/:id/photos sub-tab. Lives inside the inspection editor as
// a slide-over so the gallery view stays reachable without leaving the
// editing surface (matches the design's no-tab page chrome).
//
// Reads the same data the old sub-page did — /api/inspections/:id —
// then groups every photo by section/item for a flat browse view.

document.addEventListener('alpine:init', () => {
    Alpine.data('photoGallerySheet', (inspectionId) => ({
        inspectionId,
        open: false,
        loading: false,
        loaded: false,
        sections: [],
        totalPhotos: 0,

        toggle() {
            this.open = !this.open;
            if (this.open && !this.loaded) this.load();
        },
        close() { this.open = false; },

        async load() {
            this.loading = true;
            try {
                const res = await window.authFetch('/api/inspections/' + this.inspectionId);
                if (!res.ok) return;
                const j = await res.json();
                const insp = (j.data && (j.data.inspection || j.data)) || {};
                const tpl  = (j.data && (j.data.template || (j.data.inspection && j.data.inspection.templateSnapshot))) || null;
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
                this.loaded = true;
            } catch (e) {
                console.error('photoGallery.load failed', e);
            } finally {
                this.loading = false;
            }
        },
    }));
});
