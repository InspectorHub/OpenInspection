// ���� Offline photo queue ??IndexedDB store for blobs pending upload ����������
const pendingPhotoDb = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('oi_pending_photos', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('queue', { keyPath: 'id' });
      req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },
  async add(record) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('queue', 'readwrite');
      tx.objectStore('queue').put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },
  async getAll() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('queue', 'readonly');
      const req = tx.objectStore('queue').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async remove(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('queue', 'readwrite');
      tx.objectStore('queue').delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
};

function fileToDataUrl(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

document.addEventListener('alpine:init', () => {
  Alpine.data('inspectionForm', (inspectionId) => ({
    inspectionId,
    inspection: null,
    template: null,
    templateSchema: { sections: [] },
    results: {},
    openSections: [],
    online: navigator.onLine,
    syncing: false,
    uploading: {},
    isDelivered: false,
    scrolled: false,

    // Annotation State
    showAnnotationModal: false,
    annotationTarget: null,
    drawingMode: 'circle',
    isDrawing: false,
    startX: 0,
    startY: 0,
    annotationCanvas: null,
    annotationCtx: null,
    annotationImage: null,
    offscreenCanvas: null,
    offscreenCtx: null,

    async init() {
      window.addEventListener('scroll', () => { this.scrolled = window.scrollY > 20; });
      window.addEventListener('offline', () => { this.online = false; });
      window.addEventListener('online', () => {
        this.online = true;
        this.flushPendingPhotos();
        this.syncData();
      });
      await this.loadData();
      if (this.online) { this.flushPendingPhotos(); }
      if (this.templateSchema.sections.length > 0) {
        this.openSections.push(this.templateSchema.sections[0].id);
      }
    },

    async loadData() {
      try {
        const res = await fetch(`/api/inspections/${this.inspectionId}`);
        const data = await res.json();
        this.inspection = data.inspection;
        this.template = data.template;
        this.templateSchema = typeof data.template.schema === 'string' ? JSON.parse(data.template.schema) : data.template.schema;

        this.templateSchema.sections.forEach(s => {
          s.items.forEach(i => {
            this.results[i.id] = { status: null, notes: '', photos: [] };
            this.uploading[i.id] = false;
          });
        });

        const localData = await this.getLocalData();
        if (localData) {
          this.results = { ...this.results, ...localData };
        } else {
          const resultRes = await fetch(`/api/inspections/${this.inspectionId}/results`);
          const resultData = await resultRes.json();
          if (resultData.data) {
            this.results = { ...this.results, ...resultData.data };
          }
        }
      } catch (e) {
        console.error('Failed to load inspection data', e);
      }
    },

    toggleSection(id) {
      if (this.openSections.includes(id)) {
        this.openSections = this.openSections.filter(sid => sid !== id);
      } else {
        this.openSections.push(id);
      }
    },

    setItemStatus(itemId, status) {
      this.results[itemId].status = status;
      this.saveLocally();
    },

    async handleFileUpload(itemId, event) {
      const file = event.target.files[0];
      if (!file) return;
      if (!this.results[itemId].photos) this.results[itemId].photos = [];

      if (!this.online) {
        // Queue locally ??upload when back online
        const localId = 'pending:' + crypto.randomUUID();
        const dataUrl = await fileToDataUrl(file);
        await pendingPhotoDb.add({ id: localId, inspectionId: this.inspectionId, itemId, blob: file, type: 'upload' });
        this.results[itemId].photos.push({ key: localId, pending: true, dataUrl });
        this.saveLocally();
        event.target.value = '';
        return;
      }

      this.uploading[itemId] = true;
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('itemId', itemId);
        const res = await fetch(`/api/inspections/${this.inspectionId}/upload`, { method: 'POST', body: formData });
        if (res.ok) {
          const { key } = await res.json();
          this.results[itemId].photos.push({ key });
          this.saveLocally();
        } else {
          modalAlert('Failed to upload photo', 'Error');
        }
      } catch (e) {
        console.error('Upload failed', e);
      } finally {
        this.uploading[itemId] = false;
        event.target.value = '';
      }
    },

    removePhoto(itemId, index) {
      this.results[itemId].photos.splice(index, 1);
      this.saveLocally();
    },

    startAnnotation(itemId, photoKey, index) {
      this.annotationTarget = { itemId, photoKey, index };
      this.showAnnotationModal = true;
      this.$nextTick(() => this.initAnnotationCanvas());
    },

    initAnnotationCanvas() {
      const canvas = this.$refs.annotationCanvas;
      const ctx = canvas.getContext('2d');
      this.annotationCanvas = canvas;
      this.annotationCtx = ctx;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = '/api/inspections/files/' + this.annotationTarget.photoKey;
      img.onload = () => {
        this.annotationImage = img;
        const containerWidth = Math.min(window.innerWidth - 40, 800);
        const scale = containerWidth / img.width;
        canvas.width = containerWidth;
        canvas.height = img.height * scale;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.lineCap = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#ef4444';
      };
    },

    handleCanvasStart(e) {
      const rect = this.annotationCanvas.getBoundingClientRect();
      const x = ((e.clientX || e.touches?.[0]?.clientX) - rect.left);
      const y = ((e.clientY || e.touches?.[0]?.clientY) - rect.top);
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = this.annotationCanvas.width;
      this.offscreenCanvas.height = this.annotationCanvas.height;
      this.offscreenCtx = this.offscreenCanvas.getContext('2d');
      this.offscreenCtx.drawImage(this.annotationCanvas, 0, 0);
      this.isDrawing = true;
      this.startX = x;
      this.startY = y;
    },

    handleCanvasMove(e) {
      if (!this.isDrawing) return;
      const rect = this.annotationCanvas.getBoundingClientRect();
      const x = ((e.clientX || e.touches?.[0]?.clientX) - rect.left);
      const y = ((e.clientY || e.touches?.[0]?.clientY) - rect.top);
      this.annotationCtx.clearRect(0, 0, this.annotationCanvas.width, this.annotationCanvas.height);
      this.annotationCtx.drawImage(this.offscreenCanvas, 0, 0);
      this.drawShape(this.startX, this.startY, x, y, this.annotationCtx);
    },

    handleCanvasEnd(e) {
      if (!this.isDrawing) return;
      const rect = this.annotationCanvas.getBoundingClientRect();
      const x = ((e.changedTouches ? e.changedTouches[0].clientX : e.clientX) - rect.left);
      const y = ((e.changedTouches ? e.changedTouches[0].clientY : e.clientY) - rect.top);
      this.annotationCtx.drawImage(this.offscreenCanvas, 0, 0);
      this.drawShape(this.startX, this.startY, x, y, this.annotationCtx);
      this.isDrawing = false;
    },

    drawShape(x1, y1, x2, y2, ctx) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      if (this.drawingMode === 'circle') {
        const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        ctx.beginPath();
        ctx.arc(x1, y1, radius, 0, 2 * Math.PI);
        ctx.stroke();
      } else if (this.drawingMode === 'arrow') {
        this.drawArrow(x1, y1, x2, y2, ctx);
      }
    },

    drawArrow(fromx, fromy, tox, toy, ctx) {
      const headlen = 15;
      const dx = tox - fromx;
      const dy = toy - fromy;
      const angle = Math.atan2(dy, dx);
      ctx.beginPath();
      ctx.moveTo(fromx, fromy);
      ctx.lineTo(tox, toy);
      ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(tox, toy);
      ctx.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    },

    clearAnnotation() {
      const ctx = this.annotationCtx;
      const canvas = this.annotationCanvas;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(this.annotationImage, 0, 0, canvas.width, canvas.height);
    },

    async saveAnnotation() {
      this.syncing = true;
      try {
        const blob = await new Promise(resolve => this.annotationCanvas.toBlob(resolve, 'image/webp', 0.8));
        const file = new File([blob], 'annotated.webp', { type: 'image/webp' });

        if (!this.online) {
          const localId = 'pending:' + crypto.randomUUID();
          const dataUrl = this.annotationCanvas.toDataURL('image/webp', 0.8);
          await pendingPhotoDb.add({
            id: localId,
            inspectionId: this.inspectionId,
            itemId: this.annotationTarget.itemId,
            photoIndex: this.annotationTarget.index,
            blob: file,
            type: 'annotation',
          });
          this.results[this.annotationTarget.itemId].photos[this.annotationTarget.index] = { key: localId, pending: true, dataUrl };
          this.saveLocally();
          this.showAnnotationModal = false;
          return;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('itemId', this.annotationTarget.itemId);
        const res = await fetch(`/api/inspections/${this.inspectionId}/upload`, { method: 'POST', body: formData });
        if (res.ok) {
          const { key } = await res.json();
          this.results[this.annotationTarget.itemId].photos[this.annotationTarget.index].key = key;
          this.saveLocally();
          this.showAnnotationModal = false;
        } else {
          modalAlert('Failed to save annotation', 'Error');
        }
      } catch (e) {
        console.error('Save annotation failed', e);
      } finally {
        this.syncing = false;
      }
    },

    async flushPendingPhotos() {
      let queue;
      try { queue = await pendingPhotoDb.getAll(); } catch { return; }
      const mine = queue.filter(r => r.inspectionId === this.inspectionId);
      for (const record of mine) {
        try {
          const formData = new FormData();
          formData.append('file', record.blob instanceof File ? record.blob : new File([record.blob], 'photo.webp', { type: 'image/webp' }));
          formData.append('itemId', record.itemId);
          const res = await fetch(`/api/inspections/${this.inspectionId}/upload`, { method: 'POST', body: formData });
          if (res.ok) {
            const { key } = await res.json();
            // Replace the pending entry in results with the real R2 key
            for (const iid of Object.keys(this.results)) {
              const photos = this.results[iid].photos || [];
              const idx = photos.findIndex(p => p.key === record.id);
              if (idx !== -1) { photos[idx] = { key }; }
            }
            await pendingPhotoDb.remove(record.id);
          }
        } catch (e) {
          console.warn('Flush pending photo failed:', e);
        }
      }
      this.saveLocally();
    },

    get completionPercentage() {
      const items = [];
      this.templateSchema.sections.forEach(s => items.push(...s.items));
      if (items.length === 0) return 0;
      const filled = items.filter(i => this.results[i.id]?.status).length;
      return Math.round((filled / items.length) * 100);
    },

    get isComplete() {
      return this.completionPercentage === 100;
    },

    async saveLocally() {
      localStorage.setItem(`inspection_${this.inspectionId}`, JSON.stringify(this.results));
      if (this.online) { this.syncData(); }
    },

    async getLocalData() {
      const data = localStorage.getItem(`inspection_${this.inspectionId}`);
      return data ? JSON.parse(data) : null;
    },

    async syncData() {
      if (this.syncing || !this.online) return;
      this.syncing = true;
      try {
        await fetch(`/api/inspections/${this.inspectionId}/results`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: this.results })
        });
      } catch (e) {
        console.error('Sync failed', e);
      } finally {
        this.syncing = false;
      }
    },

    async finishInspection() {
      if (this.syncing) return;
      this.syncing = true;
      try {
        await this.syncData();
        const res = await fetch(`/api/inspections/${this.inspectionId}/complete`, { method: 'POST' });
        if (res.ok) {
          this.isDelivered = true;
          if (this.inspection) this.inspection.status = 'completed';
        } else {
          modalAlert('Failed to mark inspection as complete on server.', 'Error');
        }
      } catch (e) {
        console.error('Completion failed', e);
      } finally {
        this.syncing = false;
      }
    },

    async assistComment(itemId, label) {
      const currentText = this.results[itemId]?.notes;
      if (!currentText || currentText.length < 3) return;
      try {
        const res = await fetch('/api/ai/comment-assist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: currentText, context: label })
        });
        const data = await res.json();
        if (data.text) {
          this.results[itemId].notes = data.text;
          this.saveLocally();
        }
      } catch (e) {
        console.error('AI Assist Error:', e);
      }
    },

    backToDashboard() {
      window.location.href = '/dashboard';
    }
  }));
});
