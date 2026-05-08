// Phase T (T14): Konva-based photo annotator.
// Listens for `annotate` window CustomEvent: { detail: { inspectionId, itemId, photoIndex, imageUrl, existingNodesJson? } }
// On save, dispatches `photo:annotated` window CustomEvent with { detail: { itemId, photoIndex, annotatedKey } }.

function photoAnnotator() {
    return {
        open: false,
        saving: false,
        currentTool: 'arrow',
        color: '#ef4444',
        lineWidth: 4,
        stage: null,
        layer: null,
        history: [],
        historyStep: -1,
        bgImage: null,
        currentInspectionId: null,
        currentItemId: null,
        currentPhotoIndex: -1,

        tools: [
            { id: 'select',    label: 'Select',    icon: '⤧' },
            { id: 'circle',    label: 'Circle',    icon: '○' },
            { id: 'arrow',     label: 'Arrow',     icon: '→' },
            { id: 'rect',      label: 'Rectangle', icon: '▢' },
            { id: 'line',      label: 'Line',      icon: '╱' },
            { id: 'text',      label: 'Text',      icon: 'T' },
            { id: 'pen',       label: 'Pen',       icon: '✎' },
            { id: 'rotate',    label: 'Rotate',    icon: '↻' },
        ],

        async openPhoto({ inspectionId, itemId, photoIndex, imageUrl, existingNodesJson }) {
            this.open = true;
            this.currentInspectionId = inspectionId;
            this.currentItemId = itemId;
            this.currentPhotoIndex = photoIndex;
            this.history = [];
            this.historyStep = -1;
            try {
                await loadKonva();
            } catch (e) {
                this.open = false;
                if (typeof modalAlert === 'function') {
                    modalAlert('Failed to load the photo annotator. Check your network and try again.', 'Annotator unavailable');
                }
                return;
            }
            await this.$nextTick();
            await this.initStage(imageUrl, existingNodesJson);
        },

        async initStage(imageUrl, existingNodesJson) {
            const container = document.getElementById('annotatorContainer');
            if (!container) return;
            container.innerHTML = '';
            const img = await loadImage(imageUrl);
            const maxW = Math.min(window.innerWidth - 80, 1280);
            const maxH = window.innerHeight - 120;
            const scale = Math.min(maxW / img.width, maxH / img.height, 1);
            const w = img.width * scale;
            const h = img.height * scale;
            container.style.width = w + 'px';
            container.style.height = h + 'px';

            this.stage = new Konva.Stage({ container, width: w, height: h });
            const bgLayer = new Konva.Layer();
            this.bgImage = new Konva.Image({ image: img, width: w, height: h });
            bgLayer.add(this.bgImage);
            this.stage.add(bgLayer);

            this.layer = new Konva.Layer();
            this.stage.add(this.layer);

            if (existingNodesJson) {
                try {
                    const nodes = JSON.parse(existingNodesJson);
                    nodes.forEach((cfg) => {
                        const node = Konva.Node.create(JSON.stringify(cfg));
                        this.layer.add(node);
                    });
                    this.layer.draw();
                } catch { /* ignore parse error */ }
            }

            this.snapshot();
            this.bindDrawing();
        },

        bindDrawing() {
            let drawing = false;
            let shape = null;
            let startPos = null;

            this.stage.on('mousedown touchstart', () => {
                if (this.currentTool === 'select') return;
                const pos = this.stage.getPointerPosition();
                startPos = pos;
                drawing = true;
                if (this.currentTool === 'circle') {
                    shape = new Konva.Circle({ x: pos.x, y: pos.y, radius: 0, stroke: this.color, strokeWidth: parseFloat(this.lineWidth), draggable: true });
                } else if (this.currentTool === 'rect') {
                    shape = new Konva.Rect({ x: pos.x, y: pos.y, width: 0, height: 0, stroke: this.color, strokeWidth: parseFloat(this.lineWidth), draggable: true });
                } else if (this.currentTool === 'arrow') {
                    shape = new Konva.Arrow({ points: [pos.x, pos.y, pos.x, pos.y], stroke: this.color, fill: this.color, strokeWidth: parseFloat(this.lineWidth), pointerLength: 12, pointerWidth: 12, draggable: true });
                } else if (this.currentTool === 'line') {
                    shape = new Konva.Line({ points: [pos.x, pos.y, pos.x, pos.y], stroke: this.color, strokeWidth: parseFloat(this.lineWidth), draggable: true });
                } else if (this.currentTool === 'pen') {
                    shape = new Konva.Line({ points: [pos.x, pos.y], stroke: this.color, strokeWidth: parseFloat(this.lineWidth), lineCap: 'round', lineJoin: 'round', tension: 0.4 });
                } else if (this.currentTool === 'text') {
                    // Sprint 1 A-5: replace blocking window.prompt with async OIPrompt.
                    drawing = false;
                    shape = null;
                    const self = this;
                    const stagedPos = { x: pos.x, y: pos.y };
                    if (window.OIPrompt) {
                        window.OIPrompt.open({
                            title:       'Annotation text',
                            placeholder: 'Type to label this region',
                            scope:       'photo-annotation',
                            onApply: function (text) {
                                if (!text) return;
                                const t = new Konva.Text({ x: stagedPos.x, y: stagedPos.y, text, fill: self.color, fontSize: 18 * (parseFloat(self.lineWidth) / 4), draggable: true });
                                self.layer.add(t);
                                self.layer.draw();
                                self.snapshot();
                            },
                        });
                    }
                    return;
                }
                if (shape) this.layer.add(shape);
            });

            this.stage.on('mousemove touchmove', () => {
                if (!drawing || !shape) return;
                const pos = this.stage.getPointerPosition();
                if (this.currentTool === 'circle') {
                    const r = Math.hypot(pos.x - startPos.x, pos.y - startPos.y);
                    shape.radius(r);
                } else if (this.currentTool === 'rect') {
                    shape.width(pos.x - startPos.x);
                    shape.height(pos.y - startPos.y);
                } else if (this.currentTool === 'arrow' || this.currentTool === 'line') {
                    shape.points([startPos.x, startPos.y, pos.x, pos.y]);
                } else if (this.currentTool === 'pen') {
                    shape.points(shape.points().concat([pos.x, pos.y]));
                }
                this.layer.batchDraw();
            });

            this.stage.on('mouseup touchend', () => {
                if (!drawing) return;
                drawing = false;
                if (shape) { this.snapshot(); }
                shape = null;
            });
        },

        setTool(id) {
            this.currentTool = id;
            if (id === 'rotate') {
                this.bgImage.rotate(90);
                this.bgImage.draw();
                this.snapshot();
            }
        },

        snapshot() {
            this.history = this.history.slice(0, this.historyStep + 1);
            this.history.push(this.layer.toJSON());
            this.historyStep++;
        },

        undo() {
            if (this.historyStep <= 0) return;
            this.historyStep--;
            this.restore();
        },

        redo() {
            if (this.historyStep >= this.history.length - 1) return;
            this.historyStep++;
            this.restore();
        },

        restore() {
            const json = this.history[this.historyStep];
            this.layer.destroy();
            this.layer = Konva.Node.create(json);
            this.stage.add(this.layer);
            this.layer.draw();
        },

        clear() {
            this.layer.destroyChildren();
            this.layer.draw();
            this.snapshot();
        },

        cancel() { this.open = false; },

        async save() {
            if (this.saving) return;
            this.saving = true;
            try {
                const dataUrl = this.stage.toDataURL({ pixelRatio: 2, mimeType: 'image/png' });
                const blob = await (await fetch(dataUrl)).blob();
                const fd = new FormData();
                fd.append('image', new File([blob], 'annotated.png', { type: 'image/png' }));
                const nodes = this.layer.children.map((c) => JSON.parse(c.toJSON()));
                fd.append('nodes', JSON.stringify(nodes));
                const url = '/api/inspections/' + encodeURIComponent(this.currentInspectionId)
                    + '/items/' + encodeURIComponent(this.currentItemId)
                    + '/photos/' + this.currentPhotoIndex
                    + '/annotation';
                const res = await authFetch(url, { method: 'POST', body: fd });
                if (!res.ok) {
                    alert('Save failed.');
                    return;
                }
                const data = await res.json();
                window.dispatchEvent(new CustomEvent('photo:annotated', {
                    detail: {
                        itemId: this.currentItemId,
                        photoIndex: this.currentPhotoIndex,
                        annotatedKey: data.data?.annotatedKey,
                    }
                }));
                this.open = false;
            } finally {
                this.saving = false;
            }
        },
    };
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

// Lazy-load Konva (~150KB) the first time the user opens the annotator.
// Cached in a single Promise so concurrent `annotate` events share one fetch.
let _konvaLoadPromise = null;
function loadKonva() {
    if (typeof window.Konva !== 'undefined') return Promise.resolve();
    if (_konvaLoadPromise) return _konvaLoadPromise;
    _konvaLoadPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/vendor/konva/konva.min.js';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = (e) => { _konvaLoadPromise = null; reject(e); };
        document.head.appendChild(s);
    });
    return _konvaLoadPromise;
}
