function inspectionOnboarding() {
    return {
        active: false,
        stepIdx: 0,
        levels: [],

        async init(levels) {
            this.levels = Array.isArray(levels) ? levels : [];
            // Local fast-path: if user dismissed previously the localStorage
            // flag is set. Avoids re-showing the modal when the API write
            // failed silently or the response is slow.
            try { if (localStorage.getItem('oi.onboarding.inspectionEdit') === '1') return; } catch {}
            try {
                const r = await authFetch('/api/users/me/onboarding');
                if (r.status === 401) { window.location.href = '/login'; return; }
                if (!r.ok) return;
                const d = await r.json();
                if (!d.data?.state?.inspectionEdit && this.levels.length > 0) {
                    this.active = true;
                    this.stepIdx = 0;
                    this._updateAnchorHighlight();
                }
            } catch { /* silent */ }
        },

        // Step 0 ("Rating Buttons") points to the actual rating buttons so the
        // user knows where to look. Adds a pulsing ring class to the first
        // visible rating-button group and removes it on advance/dismiss.
        _updateAnchorHighlight() {
            document.querySelectorAll('.onboarding-anchor').forEach(el =>
                el.classList.remove('onboarding-anchor', 'animate-pulse', 'ring-4', 'ring-indigo-400', 'ring-offset-4', 'rounded-md'));
            if (this.active && this.stepIdx === 0) {
                const target = document.querySelector('[data-rating-row]');
                if (target) {
                    target.classList.add('onboarding-anchor', 'animate-pulse', 'ring-4', 'ring-indigo-400', 'ring-offset-4', 'rounded-md');
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        },

        get totalSteps() { return this.levels.length + 1; },

        get currentStep() {
            if (this.stepIdx === 0) {
                return {
                    title: 'Rating Buttons',
                    body: 'Each item gets a rating. Tap one of the colored buttons for each item to record your evaluation. Hover (or long-press on touch) to see what each abbreviation means.',
                };
            }
            const level = this.levels[this.stepIdx - 1];
            return {
                title: level.label,
                body: level.description || 'No description set for this level. You can add one in the template editor.',
                color: level.color,
                abbr: level.abbreviation,
            };
        },

        next() {
            if (this.stepIdx + 1 < this.totalSteps) {
                this.stepIdx++;
                this._updateAnchorHighlight();
            } else this.dismiss();
        },

        skip() { this.dismiss(); },

        async dismiss() {
            this.active = false;
            this._updateAnchorHighlight();
            // Persist locally first so even if the API call fails, the modal
            // does not re-show on next page load.
            try { localStorage.setItem('oi.onboarding.inspectionEdit', '1'); } catch {}
            try {
                const r = await authFetch('/api/users/me/onboarding', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'inspectionEdit', completed: true }),
                });
                if (r && r.status === 401) { window.location.href = '/login'; return; }
            } catch { /* silent */ }
        },
    };
}
