// Template Editor — Alpine.js data function
// Requires auth.js to be loaded first (provides authFetch)

function templateEditor() {
    return {
        showRatingModal: false,
        showCannedPanel: false,
        showIconPicker: false,
        previewMode: false,
        selectedSectionId: null,
        selectedItemId: null,
        commentSearch: '',
        choicesText: '',
        saving: false,
        saveSuccess: false,
        saveError: '',
        loadError: '',
        templateId: null,
        _sectionsSortable: null,
        _itemsSortable: null,

        recommendationTypes: [
            'electrician','plumber','roofer','hvac','structural_engineer','pest_control',
            'foundation','general_contractor','appliance_repair','chimney','garage_door',
            'landscaper','painter','mason','window_door','insulation','waterproofing','other'
        ],

        sectionColors: ['#4a72ff','#e64980','#0ea5e9','#f59e0b','#22c55e','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#ef4444','#06b6d4','#84cc16','#a855f7','#10b981','#d946ef'],

        template: {
            title: '',
            version: 1,
            source: null,
            ratingSystem: {
                name: 'Standard 5-Level',
                defaultLevelId: 'S',
                source: null,
                levels: [
                    { id: 'S', label: 'Satisfactory', abbreviation: 'Sat', color: '#22c55e', severity: 'good', isDefect: false, default: true, description: 'In good working order' },
                    { id: 'M', label: 'Monitor', abbreviation: 'Mon', color: '#f59e0b', severity: 'marginal', isDefect: false, default: false, description: 'May need maintenance' },
                    { id: 'D', label: 'Defect', abbreviation: 'D', color: '#ef4444', severity: 'significant', isDefect: true, default: false, description: 'Repair needed' },
                    { id: 'NI', label: 'Not Inspected', abbreviation: 'NI', color: '#9ca3af', severity: 'minor', isDefect: false, default: false, description: '' },
                    { id: 'NP', label: 'Not Present', abbreviation: 'NP', color: '#6b7280', severity: 'minor', isDefect: false, default: false, description: '' },
                ]
            },
            sections: []
        },

        ratingPresets: [
            { name: 'Standard 3-Level', levels: [
                { id: 'S', label: 'Satisfactory', abbreviation: 'S', color: '#22c55e', severity: 'good', isDefect: false, default: true },
                { id: 'M', label: 'Monitor', abbreviation: 'M', color: '#f59e0b', severity: 'marginal', isDefect: false, default: false },
                { id: 'D', label: 'Defect', abbreviation: 'D', color: '#ef4444', severity: 'significant', isDefect: true, default: false },
            ]},
            { name: 'Standard 5-Level', levels: [
                { id: 'S', label: 'Satisfactory', abbreviation: 'Sat', color: '#22c55e', severity: 'good', isDefect: false, default: true },
                { id: 'M', label: 'Monitor', abbreviation: 'Mon', color: '#f59e0b', severity: 'marginal', isDefect: false, default: false },
                { id: 'D', label: 'Defect', abbreviation: 'D', color: '#ef4444', severity: 'significant', isDefect: true, default: false },
                { id: 'NI', label: 'Not Inspected', abbreviation: 'NI', color: '#9ca3af', severity: 'minor', isDefect: false, default: false },
                { id: 'NP', label: 'Not Present', abbreviation: 'NP', color: '#6b7280', severity: 'minor', isDefect: false, default: false },
            ]},
            { name: 'TREC', levels: [
                { id: 'I', label: 'Inspected', abbreviation: 'I', color: '#22c55e', severity: 'good', isDefect: false, default: true },
                { id: 'D', label: 'Deficient', abbreviation: 'D', color: '#ef4444', severity: 'significant', isDefect: true, default: false },
                { id: 'NI', label: 'Not Inspected', abbreviation: 'NI', color: '#9ca3af', severity: 'minor', isDefect: false, default: false },
                { id: 'NP', label: 'Not Present', abbreviation: 'NP', color: '#6b7280', severity: 'minor', isDefect: false, default: false },
                { id: 'INR', label: 'In Need of Repair', abbreviation: 'INR', color: '#f97316', severity: 'significant', isDefect: true, default: false },
            ]},
            { name: 'ITB Default (8-Level)', levels: [
                { id: 'F', label: 'Functional', abbreviation: 'F', color: '#22c55e', severity: 'good', isDefect: false, default: true },
                { id: 'LM', label: 'Maintenance Item', abbreviation: 'LM', color: '#84cc16', severity: 'marginal', isDefect: false, default: false },
                { id: 'Mon', label: 'Monitor', abbreviation: 'Mon', color: '#eab308', severity: 'marginal', isDefect: false, default: false },
                { id: 'Mar', label: 'Marginal', abbreviation: 'Mar', color: '#f59e0b', severity: 'marginal', isDefect: false, default: false },
                { id: 'D', label: 'Defective', abbreviation: 'D', color: '#ef4444', severity: 'significant', isDefect: true, default: false },
                { id: 'H', label: 'Hazardous', abbreviation: 'H', color: '#dc2626', severity: 'significant', isDefect: true, default: false },
                { id: 'NP', label: 'Not Present', abbreviation: 'NP', color: '#9ca3af', severity: 'minor', isDefect: false, default: false },
                { id: 'NI', label: 'Not Inspected', abbreviation: 'NI', color: '#6b7280', severity: 'minor', isDefect: false, default: false },
            ]},
        ],

        cannedComments: [],
        newCommentText: '',
        newCommentCategory: '',

        get selectedSection() {
            return this.template.sections.find(s => s.id === this.selectedSectionId) || null;
        },
        get selectedItem() {
            if (!this.selectedSection || !this.selectedItemId) return null;
            return this.selectedSection.items.find(i => i.id === this.selectedItemId) || null;
        },

        sectionColor(section) {
            const idx = this.template.sections.indexOf(section);
            return this.sectionColors[idx % this.sectionColors.length];
        },

        selectSection(id) {
            this.selectedSectionId = id;
            this.selectedItemId = null;
        },
        selectItem(id) { this.selectedItemId = id; this.updateChoicesText(); },

        addSection() {
            const id = 'sec_' + Date.now();
            this.template.sections.push({ id, title: 'New Section', identifier: '', icon: '', priority: this.template.sections.length, isOverview: false, disclaimerText: '', source: null, items: [] });
            this.selectedSectionId = id;
            this.selectedItemId = null;
        },
        removeSection(id) {
            this.template.sections = this.template.sections.filter(s => s.id !== id);
            if (this.selectedSectionId === id) { this.selectedSectionId = null; this.selectedItemId = null; }
        },
        addItem() {
            if (!this.selectedSection) return;
            const id = 'item_' + Date.now();
            this.selectedSection.items.push({
                id, label: 'New Item', description: '', type: 'rating',
                options: { min: null, max: null, unit: '', step: null, placeholder: '', maxLength: null, choices: [], minPhotos: null },
                required: false, priority: this.selectedSection.items.length, isSafety: false,
                defaultRecommendation: '', defaultEstimateMin: null, defaultEstimateMax: null,
                attributes: [], source: null
            });
            this.selectedItemId = id;
        },
        removeItem(id) {
            if (!this.selectedSection) return;
            this.selectedSection.items = this.selectedSection.items.filter(i => i.id !== id);
            if (this.selectedItemId === id) this.selectedItemId = null;
        },
        addAttribute() {
            if (!this.selectedItem) return;
            if (!this.selectedItem.attributes) this.selectedItem.attributes = [];
            this.selectedItem.attributes.push({
                id: 'attr_' + Date.now(), name: '', type: 'boolean', choices: [], unit: '',
                required: false, isSafety: false, isDefect: false,
                recommendation: null, estimateMin: null, estimateMax: null,
                source: null, _choicesStr: ''
            });
        },
        updateChoicesText() {
            if (this.selectedItem && this.selectedItem.options && this.selectedItem.options.choices) {
                this.choicesText = this.selectedItem.options.choices.join('\n');
            } else { this.choicesText = ''; }
        },
        updateChoices() {
            if (!this.selectedItem) return;
            if (!this.selectedItem.options) this.selectedItem.options = {};
            this.selectedItem.options.choices = this.choicesText.split('\n').map(s => s.trim()).filter(Boolean);
        },
        applyRatingPreset(preset) {
            this.template.ratingSystem.name = preset.name;
            this.template.ratingSystem.levels = JSON.parse(JSON.stringify(preset.levels));
            this.template.ratingSystem.defaultLevelId = preset.levels.find(l => l.default)?.id || preset.levels[0]?.id;
        },
        addRatingLevel() {
            this.template.ratingSystem.levels.push({ id: 'NEW', label: 'New Level', abbreviation: '', color: '#6b7280', severity: 'minor', isDefect: false, default: false, description: '' });
        },

        // Section icon SVG paths — 18 common inspection categories
        sectionIcons: {
            exterior:    '<path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0V15a1 1 0 011-1h2a1 1 0 011 1v3"/>',
            roof:        '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3L2 12h3v8h14v-8h3L12 3zM7 20v-7h10v7"/>',
            electrical:  '<path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>',
            plumbing:    '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v4m0 0a4 4 0 014 4v6a3 3 0 01-3 3h-2a3 3 0 01-3-3v-6a4 4 0 014-4z"/>',
            hvac:        '<path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>',
            interior:    '<path stroke-linecap="round" stroke-linejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8h16v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zm2 0V9m12 4V9"/>',
            structural:  '<path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2M5 21H3m4-10h2m4 0h2m-8 4h2m4 0h2"/>',
            foundation:  '<path stroke-linecap="round" stroke-linejoin="round" d="M4 20h16M4 20V10l8-7 8 7v10M4 20h4v-4h8v4h4"/>',
            garage:      '<path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M3 10l9-7 9 7M5 10v11m14-11v11M8 14h8M8 17h8"/>',
            kitchen:     '<path stroke-linecap="round" stroke-linejoin="round" d="M15 11V4a1 1 0 10-2 0v7m2 0H9m4 0a2 2 0 11-4 0m0 0V4a1 1 0 10-2 0v7m14 4H3l1.5 6h15L21 15z"/>',
            bathroom:    '<path stroke-linecap="round" stroke-linejoin="round" d="M4 12h16M4 12V8a4 4 0 014-4h1m-5 8v4a4 4 0 004 4h8a4 4 0 004-4v-4M18 8a2 2 0 11-4 0"/>',
            fireplace:   '<path stroke-linecap="round" stroke-linejoin="round" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A8 8 0 0117.657 18.657zM9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z"/>',
            pool:        '<path stroke-linecap="round" stroke-linejoin="round" d="M3 17c1.5 0 2.5-1 4-1s2.5 1 4 1 2.5-1 4-1 2.5 1 4 1M3 21c1.5 0 2.5-1 4-1s2.5 1 4 1 2.5-1 4-1 2.5 1 4 1M5 3v10m14-10v10"/>',
            insulation:  '<path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>',
            appliances:  '<path stroke-linecap="round" stroke-linejoin="round" d="M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm7 14a4 4 0 100-8 4 4 0 000 8zm0-6a2 2 0 110 4 2 2 0 010-4z"/>',
            attic:       '<path stroke-linecap="round" stroke-linejoin="round" d="M3 17l9-13 9 13M7 17v4h10v-4M10 17v4m4-4v4"/>',
            crawlspace:  '<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 6v4m16-4v4M4 10h16M4 10v4h16v-4M8 14v4m8-4v4M4 18h16"/>',
            safety:      '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>',
            landscape:   '<path stroke-linecap="round" stroke-linejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"/>',
        },

        get sectionIconKeys() { return Object.keys(this.sectionIcons); },

        getSectionIconSvg(iconKey, cls) {
            const size = cls || 'w-4 h-4';
            if (iconKey && this.sectionIcons[iconKey]) {
                return '<svg class="' + size + '" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">' + this.sectionIcons[iconKey] + '</svg>';
            }
            return null;
        },

        filteredComments() {
            if (!this.commentSearch) return this.cannedComments;
            const q = this.commentSearch.toLowerCase();
            return this.cannedComments.filter(c => c.text.toLowerCase().includes(q) || (c.category || '').toLowerCase().includes(q));
        },

        async loadCannedComments() {
            try {
                const res = await authFetch('/api/admin/comments');
                if (!res.ok) return;
                const data = await res.json();
                this.cannedComments = data.data?.comments || [];
            } catch (e) {
                console.error('Failed to load comments:', e);
            }
        },

        async addCannedComment() {
            const text = this.newCommentText.trim();
            if (!text) return;
            const category = this.newCommentCategory.trim() || null;
            try {
                const res = await authFetch('/api/admin/comments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, category })
                });
                if (!res.ok) return;
                this.newCommentText = '';
                this.newCommentCategory = '';
                await this.loadCannedComments();
            } catch (e) {
                console.error('Failed to add comment:', e);
            }
        },

        async deleteCannedComment(id) {
            try {
                const res = await authFetch('/api/admin/comments/' + id, { method: 'DELETE' });
                if (!res.ok) return;
                await this.loadCannedComments();
            } catch (e) {
                console.error('Failed to delete comment:', e);
            }
        },

        async saveTemplate() {
            this.saving = true;
            this.saveError = '';
            try {
                const res = await authFetch('/api/inspections/templates/' + this.templateId, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: this.template.title,
                        schema: {
                            sections: this.template.sections,
                            ratingSystem: this.template.ratingSystem
                        }
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    this.template.version = data.data?.version || data.version || this.template.version + 1;
                    this.saveSuccess = true;
                    setTimeout(() => this.saveSuccess = false, 2000);
                } else {
                    const err = await res.json().catch(() => ({}));
                    this.saveError = err.error?.message || 'Failed to save';
                }
            } catch {
                this.saveError = 'Network error';
            }
            this.saving = false;
        },

        initSortable() {
            const self = this;

            const sectionsEl = document.getElementById('sectionsList');
            if (sectionsEl) {
                this._sectionsSortable = new Sortable(sectionsEl, {
                    animation: 200,
                    handle: '.drag-handle',
                    ghostClass: 'sortable-ghost',
                    chosenClass: 'sortable-chosen',
                    dragClass: 'sortable-drag',
                    onEnd(evt) {
                        const sections = [...self.template.sections];
                        const [moved] = sections.splice(evt.oldIndex, 1);
                        sections.splice(evt.newIndex, 0, moved);
                        sections.forEach((s, i) => s.priority = i);
                        self.template.sections = sections;
                    }
                });
            }

            this.$watch('selectedSectionId', () => {
                this.$nextTick(() => this.initItemsSortable());
            });
            this.$nextTick(() => this.initItemsSortable());
        },

        initItemsSortable() {
            if (this._itemsSortable) { this._itemsSortable.destroy(); this._itemsSortable = null; }
            const itemsEl = document.getElementById('itemsList');
            if (!itemsEl || !this.selectedSection) return;
            const self = this;
            this._itemsSortable = new Sortable(itemsEl, {
                animation: 200,
                handle: '.drag-handle',
                ghostClass: 'sortable-ghost',
                chosenClass: 'sortable-chosen',
                dragClass: 'sortable-drag',
                filter: '[x-show]',
                onEnd(evt) {
                    if (!self.selectedSection) return;
                    const items = [...self.selectedSection.items];
                    const [moved] = items.splice(evt.oldIndex, 1);
                    items.splice(evt.newIndex, 0, moved);
                    items.forEach((item, i) => item.priority = i);
                    self.selectedSection.items = items;
                }
            });
        },

        async init() {
            const wrapperEl = document.querySelector('[data-template-id]');
            this.templateId = wrapperEl ? wrapperEl.dataset.templateId : null;
            if (!this.templateId) {
                this.loadError = 'No template ID';
                return;
            }
            try {
                const res = await authFetch('/api/inspections/templates/' + this.templateId);
                if (res.status === 401) { window.location.href = '/login'; return; }
                if (!res.ok) { this.loadError = 'Failed to load template'; return; }
                const body = await res.json();
                const tpl = body.data?.template || body.template || body.data;
                if (!tpl) { this.loadError = 'Template not found'; return; }
                this.template.title = tpl.name || '';
                this.template.version = tpl.version || 1;
                const schema = typeof tpl.schema === 'string' ? JSON.parse(tpl.schema) : (tpl.schema || {});
                if (schema.sections && Array.isArray(schema.sections)) {
                    // Normalize field names: API may use "name" but editor uses "title"/"label"
                    this.template.sections = schema.sections.map(function(sec) {
                        var s = Object.assign({}, sec);
                        if (!s.title && s.name) { s.title = s.name; delete s.name; }
                        if (s.items && Array.isArray(s.items)) {
                            s.items = s.items.map(function(item) {
                                var it = Object.assign({}, item);
                                if (!it.label && it.name) { it.label = it.name; delete it.name; }
                                return it;
                            });
                        }
                        return s;
                    });
                }
                if (schema.ratingSystem) {
                    this.template.ratingSystem = schema.ratingSystem;
                }
                this.selectedSectionId = this.template.sections[0]?.id || null;
            } catch (e) {
                this.loadError = 'Network error';
                console.error('Failed to load template:', e);
            }
            this.$nextTick(() => this.initSortable());
            await this.loadCannedComments();
        }
    };
}
