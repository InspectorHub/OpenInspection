// public/js/report-client.js
function reportClient(initialData) {
  return {
    filter: 'all',
    showRepairPanel: false,
    lightboxUrl: null,
    repairItems: {},
    reportStats: initialData.stats,
    sections: initialData.sections,

    sectionHasDefects(sectionId) {
      const sec = this.sections.find(function(s) { return s.id === sectionId; });
      if (!sec) return false;
      return sec.items.some(function(i) { return i.severityBucket === 'defect' || i.severityBucket === 'monitor'; });
    },

    isDefectItem(bucket) {
      return bucket === 'defect' || bucket === 'monitor';
    },

    openLightbox(url) {
      this.lightboxUrl = url;
    },

    get selectedRepairItems() {
      var selected = [];
      for (var s = 0; s < this.sections.length; s++) {
        var sec = this.sections[s];
        for (var i = 0; i < sec.items.length; i++) {
          var item = sec.items[i];
          if (this.repairItems[item.id]) {
            selected.push(item);
          }
        }
      }
      return selected;
    },

    get selectedRepairCount() {
      return this.selectedRepairItems.length;
    },

    get estimateTotal() {
      var min = 0, max = 0;
      var items = this.selectedRepairItems;
      for (var i = 0; i < items.length; i++) {
        if (items[i].estimateMin) min += items[i].estimateMin;
        if (items[i].estimateMax) max += items[i].estimateMax;
      }
      return { min: min, max: max };
    },
  };
}
