// public/js/inspection-edit.js
// Requires auth.js to be loaded first (provides authFetch)

function inspectionEditor(inspectionId) {
  return {
    inspectionId: inspectionId,
    inspection: {},
    sections: [],
    ratingLevels: [],
    results: {},
    expanded: {},
    currentSectionIdx: 0,
    batchMode: false,
    batchSelected: {},
    showMenu: false,
    showPublishModal: false,
    publishing: false,
    isDesktop: window.innerWidth >= 1024,
    saveTimer: null,
    saveState: 'idle',
    _reportStats: { total: 0, satisfactory: 0, monitor: 0, defect: 0 },
    aiSuggestions: [],
    aiTargetField: null,
    showAiPopover: false,

    publishOptions: {
      theme: 'modern',
      notifyClient: true,
      notifyAgent: true,
      requireSignature: false,
      requirePayment: false,
    },

    async init() {
      window.addEventListener('resize', () => {
        this.isDesktop = window.innerWidth >= 1024;
      });
      await this.loadData();
    },

    async loadData() {
      try {
        var inspRes = await authFetch('/api/inspections/' + this.inspectionId);
        if (inspRes.status === 401) { window.location.href = '/login'; return; }

        var inspJson = await inspRes.json();
        this.inspection = inspJson.data?.inspection || {};

        // Try to load report-data (sections + rating levels)
        var dataRes = await authFetch('/api/inspections/' + this.inspectionId + '/report-data');
        if (dataRes.ok) {
          var dataJson = await dataRes.json();
          this.sections = (dataJson.data?.sections || []).map(function(sec) {
            var s = Object.assign({}, sec);
            if (!s.title && s.name) { s.title = s.name; }
            if (s.items && Array.isArray(s.items)) {
              s.items = s.items.map(function(item) {
                var it = Object.assign({}, item);
                if (!it.label && it.name) { it.label = it.name; }
                return it;
              });
            }
            return s;
          });
          this.ratingLevels = dataJson.data?.ratingLevels || [];
          this._reportStats = dataJson.data?.stats || this._reportStats;
        }

        // Load existing results
        var resultsRes = await authFetch('/api/inspections/' + this.inspectionId + '/results');
        if (resultsRes.ok) {
          var rJson = await resultsRes.json();
          this.results = rJson.data?.data || {};
        }

        // Ensure every item has a results entry
        for (var s = 0; s < this.sections.length; s++) {
          var sec = this.sections[s];
          for (var i = 0; i < sec.items.length; i++) {
            var item = sec.items[i];
            if (!this.results[item.id]) {
              this.results[item.id] = { rating: null, notes: '', photos: [] };
            }
          }
        }
      } catch (e) {
        console.error('Failed to load inspection data:', e);
      }
    },

    get formattedDate() {
      var d = this.inspection.date || this.inspection.scheduledDate || this.inspection.createdAt;
      if (!d) return '';
      try {
        return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      } catch { return d; }
    },

    get currentSection() {
      return this.sections[this.currentSectionIdx] || null;
    },

    get currentSectionItems() {
      return this.currentSection?.items || [];
    },

    get completionPercent() {
      var total = 0, rated = 0;
      for (var s = 0; s < this.sections.length; s++) {
        var items = this.sections[s].items;
        for (var i = 0; i < items.length; i++) {
          total++;
          if (this.results[items[i].id]?.rating) rated++;
        }
      }
      return total > 0 ? Math.round((rated / total) * 100) : 0;
    },

    get reportStats() {
      return this._reportStats;
    },

    set reportStats(val) {
      this._reportStats = val;
    },

    get selectedBatchCount() {
      var count = 0;
      var keys = Object.keys(this.batchSelected);
      for (var k = 0; k < keys.length; k++) {
        if (this.batchSelected[keys[k]]) count++;
      }
      return count;
    },

    selectSection(idx) {
      this.currentSectionIdx = idx;
      this.batchMode = false;
      this.batchSelected = {};
    },

    sectionDefectCount(sectionId) {
      var sec = null;
      for (var s = 0; s < this.sections.length; s++) {
        if (this.sections[s].id === sectionId) { sec = this.sections[s]; break; }
      }
      if (!sec) return 0;
      var count = 0;
      for (var i = 0; i < sec.items.length; i++) {
        var rating = this.results[sec.items[i].id]?.rating;
        if (!rating) continue;
        var level = null;
        for (var l = 0; l < this.ratingLevels.length; l++) {
          if (this.ratingLevels[l].id === rating) { level = this.ratingLevels[l]; break; }
        }
        if ((level && level.isDefect) || rating === 'Defect') count++;
      }
      return count;
    },

    getItemRating(itemId) {
      return this.results[itemId]?.rating || null;
    },

    getItemNotes(itemId) {
      return this.results[itemId]?.notes || '';
    },

    getPhotoCount(itemId) {
      return (this.results[itemId]?.photos || []).length;
    },

    getRatingColor(ratingId) {
      if (!ratingId) return '#d4d4d8';
      for (var l = 0; l < this.ratingLevels.length; l++) {
        if (this.ratingLevels[l].id === ratingId) return this.ratingLevels[l].color;
      }
      var legacy = { Satisfactory: '#22c55e', Monitor: '#f59e0b', Defect: '#f43f5e' };
      return legacy[ratingId] || '#d4d4d8';
    },

    // Section icon SVG paths (same as template-editor)
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

    getSectionIconSvg(iconKey, cls) {
      var size = cls || 'w-4 h-4';
      if (iconKey && this.sectionIcons[iconKey]) {
        return '<svg class="' + size + '" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">' + this.sectionIcons[iconKey] + '</svg>';
      }
      return '';
    },

    getRatingLabel(ratingId) {
      if (!ratingId) return '';
      for (var l = 0; l < this.ratingLevels.length; l++) {
        if (this.ratingLevels[l].id === ratingId) return this.ratingLevels[l].abbreviation;
      }
      return ratingId;
    },

    setRating(itemId, levelId) {
      if (!this.results[itemId]) this.results[itemId] = { rating: null, notes: '', photos: [] };
      this.results[itemId].rating = levelId;
      this.debounceSave();
    },

    toggleExpand(itemId) {
      this.expanded[itemId] = !this.expanded[itemId];
    },

    toggleBatchSelect(itemId) {
      this.batchSelected[itemId] = !this.batchSelected[itemId];
    },

    batchSelectAll() {
      var items = this.currentSectionItems;
      for (var i = 0; i < items.length; i++) {
        this.batchSelected[items[i].id] = true;
      }
    },

    batchSetRating(levelId) {
      var items = this.currentSectionItems;
      for (var i = 0; i < items.length; i++) {
        if (this.batchSelected[items[i].id]) {
          this.setRating(items[i].id, levelId);
        }
      }
      this.batchMode = false;
      this.batchSelected = {};
    },

    debounceSave() {
      clearTimeout(this.saveTimer);
      this.saveState = 'saving';
      this.saveTimer = setTimeout(() => this.saveResults(), 1000);
    },

    async saveResults() {
      this.saveState = 'saving';
      try {
        var res = await authFetch('/api/inspections/' + this.inspectionId + '/results', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: this.results }),
        });
        this.saveState = res.ok ? 'saved' : 'error';
      } catch (e) {
        console.error('Failed to save results:', e);
        this.saveState = 'error';
      }
      if (this.saveState === 'saved') {
        setTimeout(() => { if (this.saveState === 'saved') this.saveState = 'idle'; }, 2000);
      }
    },

    async uploadPhoto(itemId, event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      var formData = new FormData();
      formData.append('photo', file);
      formData.append('itemId', itemId);
      try {
        var res = await authFetch('/api/inspections/' + this.inspectionId + '/photos', {
          method: 'POST',
          body: formData,
        });
        if (res.ok) {
          var json = await res.json();
          if (!this.results[itemId].photos) this.results[itemId].photos = [];
          this.results[itemId].photos.push({ key: json.data.key });
          this.debounceSave();
        }
      } catch (e) {
        console.error('Photo upload failed:', e);
      }
    },

    previewReport() {
      window.open('/api/inspections/' + this.inspectionId + '/report', '_blank');
    },

    async publish() {
      this.publishing = true;
      try {
        var res = await authFetch('/api/inspections/' + this.inspectionId + '/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.publishOptions),
        });
        if (res.ok) {
          var json = await res.json();
          this.showPublishModal = false;
          window.location.href = json.data?.reportUrl || '/dashboard';
        } else {
          var err = await res.json();
          showToast(err.error?.message || 'Publish failed', true);
        }
      } catch (e) {
        showToast('Publish failed: ' + e.message, true);
      } finally {
        this.publishing = false;
      }
    },

    async suggestComment(itemName, sectionName, targetField, ev) {
      const btn = ev?.currentTarget || ev?.target;
      if (!btn) return;
      const origText = btn.textContent;
      btn.textContent = '...';
      btn.disabled = true;
      try {
        const res = await authFetch('/api/ai/suggest-comment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemName, sectionName }),
        });
        if (!res.ok) return;
        const json = await res.json();
        const suggestions = json.data || [];
        if (!suggestions.length) return;
        this.aiSuggestions = suggestions;
        this.aiTargetField = targetField;
        this.showAiPopover = true;
      } catch (e) {
        console.error('[AI] suggestComment error', e);
      } finally {
        btn.textContent = origText;
        btn.disabled = false;
      }
    },

    insertSuggestion(text) {
      if (this.aiTargetField) {
        this.aiTargetField.value = text;
        this.aiTargetField.dispatchEvent(new Event('input'));
      }
      this.showAiPopover = false;
      this.aiSuggestions = [];
    },
  };
}
