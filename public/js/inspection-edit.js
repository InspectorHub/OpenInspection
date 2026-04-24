// public/js/inspection-edit.js
var authFetch = function (url, opts) {
  return fetch(url, Object.assign({ credentials: 'same-origin' }, opts || {}));
};

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
    _reportStats: { total: 0, satisfactory: 0, monitor: 0, defect: 0 },

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
        this.inspection = inspJson.data || {};

        // Try to load report-data (sections + rating levels)
        var dataRes = await authFetch('/api/inspections/' + this.inspectionId + '/report-data');
        if (dataRes.ok) {
          var dataJson = await dataRes.json();
          this.sections = dataJson.data?.sections || [];
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
      this.saveTimer = setTimeout(() => this.saveResults(), 1000);
    },

    async saveResults() {
      try {
        await authFetch('/api/inspections/' + this.inspectionId + '/results', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: this.results }),
        });
      } catch (e) {
        console.error('Failed to save results:', e);
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
      window.open('/report/' + this.inspectionId, '_blank');
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
          alert(err.error?.message || 'Publish failed');
        }
      } catch (e) {
        alert('Publish failed: ' + e.message);
      } finally {
        this.publishing = false;
      }
    },
  };
}
