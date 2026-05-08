// Sprint 2 S2-2 — Inspection request switcher (multi-inspection per request).
//
// Loads the parent request (if any) for the current inspection and exposes the
// sibling list to the Alpine banner rendered above the inspection-edit toolbar.
// The factory is intentionally tiny (no external deps beyond authFetch) so it
// can run on every /inspections/:id/report load without measurable overhead.
//
// Returns immediately when:
//   - the inspection is not part of a multi-service request, or
//   - the API call fails (banner stays hidden, inspector keeps editing).

window.requestSwitcher = function (inspectionId) {
    return {
        loading:        false,
        request:        null,
        siblings:       [],
        hasSiblings:    false,
        partIndex:      0,
        partTotal:      0,
        requestIdShort: '',

        isCurrent(id) {
            return id === inspectionId;
        },

        async load() {
            this.loading = true;
            try {
                const res = await authFetch(
                    `/api/inspection-requests/by-inspection/${encodeURIComponent(inspectionId)}`
                );
                if (!res.ok) return;
                const json = await res.json();
                const request = json && json.data && json.data.request;
                if (!request || !Array.isArray(request.inspections) || request.inspections.length <= 1) {
                    return;
                }

                // Order siblings by createdAt-ish (templateId fallback) so
                // "Part 1 of 3" maps to a stable list across reloads.
                const siblings = request.inspections.slice().map((s) => ({
                    id:           s.id,
                    templateName: s.templateName || (s.templateId ? s.templateId.slice(0, 8) : 'Inspection'),
                    status:       s.status || 'unknown',
                }));

                const idx = siblings.findIndex((s) => s.id === inspectionId);
                this.request        = request;
                this.siblings       = siblings;
                this.hasSiblings    = true;
                this.partIndex      = idx >= 0 ? idx + 1 : 1;
                this.partTotal      = siblings.length;
                this.requestIdShort = String(request.id || '').slice(0, 8);
            } catch (_e) {
                // Silent fail — banner stays hidden.
            } finally {
                this.loading = false;
            }
        },
    };
};
