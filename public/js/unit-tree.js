/**
 * Design System 0520 subsystem D P2.1 — UnitTree Alpine factory.
 *
 * Backed by the REST routes added in subsystem D P1:
 *   GET    /api/inspections/:id/units
 *   POST   /api/inspections/:id/units            { parentUnitId, kind, name }
 *   PATCH  /api/inspections/:id/units/:unitId    { name? }
 *   DELETE /api/inspections/:id/units/:unitId
 *   POST   /api/inspections/:id/units/:unitId/move
 *
 * The inspection id is published by the editor mount via the global
 * `window.__inspectionEditorRoot.inspectionId`. The factory broadcasts
 * `unit-selected` on window so the report-renderer in subsystem D P3
 * can filter items to the active unit.
 */
(function () {
    function factory() {
        return {
            units: [],
            selectedUnitId: null,
            allowEnable: true,

            get hasUnits() { return this.units.length > 0; },
            get roots() {
                return this.units
                    .filter(u => !u.parentUnitId)
                    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
            },

            childrenOf(parentId) {
                return this.units
                    .filter(u => u.parentUnitId === parentId)
                    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
            },

            _inspectionId() {
                return window.__inspectionEditorRoot?.inspectionId
                    ?? document.querySelector('[data-inspection-id]')?.getAttribute('data-inspection-id')
                    ?? null;
            },

            async init() {
                const id = this._inspectionId();
                if (!id) return;
                try {
                    const r = await fetch(`/api/inspections/${id}/units`, { credentials: 'same-origin' });
                    if (r.ok) {
                        const body = await r.json();
                        this.units = body?.data?.units ?? [];
                    }
                } catch (_e) { /* leave empty — UI gracefully shows enable button */ }
            },

            selectUnit(id) {
                this.selectedUnitId = id;
                window.dispatchEvent(new CustomEvent('unit-selected', { detail: { unitId: id } }));
            },

            async addUnit(parentUnitId, kind) {
                const name = window.prompt(`${kind.charAt(0).toUpperCase() + kind.slice(1)} name:`);
                if (!name || !name.trim()) return;

                const inspectionId = this._inspectionId();
                if (!inspectionId) return;

                try {
                    const r = await fetch(`/api/inspections/${inspectionId}/units`, {
                        method:  'POST',
                        headers: { 'content-type': 'application/json' },
                        body:    JSON.stringify({ parentUnitId, kind, name: name.trim() }),
                        credentials: 'same-origin',
                    });
                    if (!r.ok) {
                        const body = await r.json().catch(() => ({}));
                        window.alert(body?.error?.message ?? `Create failed (${r.status})`);
                        return;
                    }
                    await this.init();
                } catch (_e) {
                    window.alert('Network error creating unit');
                }
            },
        };
    }

    if (window.Alpine?.data) window.Alpine.data('unitTree', factory);
    else document.addEventListener('alpine:init', () => window.Alpine.data('unitTree', factory));
    window.unitTree = factory;
})();
