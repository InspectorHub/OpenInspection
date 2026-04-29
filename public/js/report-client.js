// public/js/report-client.js
function reportClient(initialData) {
  return {
    filter: 'all',
    showRepairPanel: false,
    lightboxUrl: null,
    repairItems: {},
    reportStats: initialData.stats,
    sections: initialData.sections,

    // Agreement gate (Spectora-style)
    agreementGate: true,
    agreementLoading: true,
    agreementContent: '',
    agreementName: '',
    agreementSigned: false,
    signaturePad: null,
    signing: false,

    async init() {
      try {
        var res = await fetch('/api/inspections/' + initialData.inspectionId + '/agreement');
        var json = await res.json();
        if (!json.success || !json.data?.agreement) {
          // No agreement configured — skip gate
          this.agreementGate = false;
          this.agreementLoading = false;
          return;
        }
        this.agreementName = json.data.agreement.name;
        this.agreementContent = json.data.agreement.content;

        // Check if already signed
        var signCheck = await fetch('/api/inspections/' + initialData.inspectionId + '/sign-status');
        if (signCheck.ok) {
          var signJson = await signCheck.json();
          if (signJson.data?.signed) {
            this.agreementSigned = true;
            this.agreementGate = false;
          }
        }
      } catch (e) {
        console.error('Agreement check failed:', e);
        this.agreementGate = false;
      }
      this.agreementLoading = false;

      if (this.agreementGate && !this.agreementSigned) {
        var self = this;
        this.$nextTick(function() {
          var canvas = document.getElementById('signatureCanvas');
          if (canvas && typeof SignaturePad !== 'undefined') {
            self.signaturePad = new SignaturePad(canvas, { penColor: 'rgb(255, 255, 255)' });
            var ratio = Math.max(window.devicePixelRatio || 1, 1);
            canvas.width = canvas.offsetWidth * ratio;
            canvas.height = canvas.offsetHeight * ratio;
            canvas.getContext('2d').scale(ratio, ratio);
            self.signaturePad.clear();
          }
        });
      }
    },

    clearSignature() {
      if (this.signaturePad) this.signaturePad.clear();
    },

    async submitSignature() {
      if (!this.signaturePad || this.signaturePad.isEmpty()) return;
      this.signing = true;
      try {
        var res = await fetch('/api/inspections/' + initialData.inspectionId + '/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signatureBase64: this.signaturePad.toDataURL() })
        });
        if (res.ok) {
          this.agreementSigned = true;
          this.agreementGate = false;
        }
      } catch (e) {
        console.error('Signature submission failed:', e);
      }
      this.signing = false;
    },

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
