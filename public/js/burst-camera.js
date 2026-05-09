// S3-6 — AI burst photo capture (Alpine factory + getUserMedia logic).
//
// Long-press shutter: distinguishes a single tap (`< LONG_PRESS_MS`)
// from a sustained press (`>= LONG_PRESS_MS`). Single tap = one
// frame, hold = burst capped at MAX_BURST_FRAMES @ ~BURST_FPS.
//
// Captures live in-memory only; "Done" uploads them via the existing
// inspectionEditor._uploadBlobAsPhoto path so retry/IDB-queue is honored.
//
// Graceful degrade: if `navigator.mediaDevices.getUserMedia` is missing
// or the user denies the permission, openFor() short-circuits to the
// existing `#hotkey-photo-input` file picker.

(function () {
    var LONG_PRESS_MS = 200;        // hold threshold before burst kicks in
    var BURST_FPS     = 10;         // capped 10 fps so we never exceed 30
    var MAX_BURST_FRAMES = 30;
    var BURST_INTERVAL_MS = Math.round(1000 / BURST_FPS);

    /**
     * Pure timing helper exported for unit tests. Given the ms a press
     * has been held, returns the count of frames a burst should have
     * produced (capped at MAX_BURST_FRAMES). Frame N fires at
     * t = (N-1) * BURST_INTERVAL_MS — i.e. frame 1 immediately, frame 2
     * at 100 ms, etc. (when BURST_FPS is 10).
     */
    function burstFrameCount(heldMs) {
        if (typeof heldMs !== 'number' || heldMs < 0) return 0;
        if (heldMs < LONG_PRESS_MS) return 1; // a quick tap is a single shot
        var frames = 1 + Math.floor(heldMs / BURST_INTERVAL_MS);
        if (frames > MAX_BURST_FRAMES) frames = MAX_BURST_FRAMES;
        return frames;
    }

    // Expose constants + helper so Vitest can import without DOM.
    if (typeof window !== 'undefined') {
        window.__BURST_CAMERA = {
            LONG_PRESS_MS: LONG_PRESS_MS,
            BURST_FPS: BURST_FPS,
            MAX_BURST_FRAMES: MAX_BURST_FRAMES,
            BURST_INTERVAL_MS: BURST_INTERVAL_MS,
            burstFrameCount: burstFrameCount,
        };
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            LONG_PRESS_MS: LONG_PRESS_MS,
            BURST_FPS: BURST_FPS,
            MAX_BURST_FRAMES: MAX_BURST_FRAMES,
            BURST_INTERVAL_MS: BURST_INTERVAL_MS,
            burstFrameCount: burstFrameCount,
        };
    }

    function nextId() {
        return 'b_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function burstCameraFactory() {
        return {
            // ── reactive state (Alpine) ────────────────────────────────
            open: false,
            stream: null,
            burstActive: false,
            burstCount: 0,
            captures: [],            // [{ id, blob, url }]
            facing: 'environment',
            uploading: false,

            // ── private (don't include in template bindings) ───────────
            _itemId: null,
            _pressedAt: 0,
            _burstTimer: null,
            _shotCount: 0,
            _lastUrl: null,

            init() {
                // Listen for the editor opening the camera. The inspection-edit
                // page dispatches { detail: { itemId } } when the user wants
                // to capture for a specific item.
                window.addEventListener('burst-camera:open', (e) => {
                    var id = e && e.detail && e.detail.itemId;
                    if (id) this.openFor(id);
                });
            },

            async openFor(itemId) {
                this._itemId = itemId;
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    this._fallback('Camera API unavailable');
                    return;
                }
                try {
                    // Prefer rear camera; fall back to default if exact-match fails.
                    let stream;
                    try {
                        stream = await navigator.mediaDevices.getUserMedia({
                            video: { facingMode: { exact: this.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
                            audio: false,
                        });
                    } catch (_) {
                        stream = await navigator.mediaDevices.getUserMedia({
                            video: { facingMode: this.facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
                            audio: false,
                        });
                    }
                    this.stream = stream;
                    this.$refs.video.srcObject = stream;
                    this.captures = [];
                    this._shotCount = 0;
                    this.open = true;
                } catch (e) {
                    this._fallback('Camera permission denied');
                }
            },

            close() {
                this._stopBurst();
                if (this.stream) {
                    try { this.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) { /* ignore */ }
                    this.stream = null;
                }
                if (this.$refs && this.$refs.video) {
                    try { this.$refs.video.srcObject = null; } catch (_) { /* ignore */ }
                }
                // Revoke object URLs so we don't leak preview blobs.
                this.captures.forEach(function (c) { try { URL.revokeObjectURL(c.url); } catch (_) {} });
                this.captures = [];
                this._itemId = null;
                this.uploading = false;
                this.open = false;
            },

            async switchFacing() {
                this.facing = this.facing === 'environment' ? 'user' : 'environment';
                if (!this.open) return;
                if (this.stream) {
                    try { this.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
                }
                try {
                    var stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: this.facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
                        audio: false,
                    });
                    this.stream = stream;
                    this.$refs.video.srcObject = stream;
                } catch (_) { /* keep prior stream alive — user can close */ }
            },

            // ── shutter handlers ───────────────────────────────────────
            onShutterDown() {
                this._pressedAt = Date.now();
                // Start a "long-press intent" timer: if still pressed at
                // LONG_PRESS_MS, switch into burst mode.
                this._longPressTimer = setTimeout(() => { this._beginBurst(); }, LONG_PRESS_MS);
            },

            onShutterUp() {
                var heldMs = Date.now() - this._pressedAt;
                if (this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = null; }
                if (this.burstActive) {
                    this._stopBurst();
                } else if (heldMs < LONG_PRESS_MS) {
                    this._captureFrame();
                }
                this._pressedAt = 0;
            },

            onShutterCancel() {
                if (this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = null; }
                if (this.burstActive) this._stopBurst();
                this._pressedAt = 0;
            },

            _beginBurst() {
                if (this.burstActive) return;
                this.burstActive = true;
                this.burstCount = 0;
                this._captureFrame();         // first frame immediately
                this._burstTimer = setInterval(() => {
                    if (this._shotCount >= MAX_BURST_FRAMES || this.captures.length >= MAX_BURST_FRAMES) {
                        this._stopBurst();
                        return;
                    }
                    this._captureFrame();
                }, BURST_INTERVAL_MS);
            },

            _stopBurst() {
                if (this._burstTimer) { clearInterval(this._burstTimer); this._burstTimer = null; }
                this.burstActive = false;
            },

            _captureFrame() {
                var video = this.$refs && this.$refs.video;
                var canvas = this.$refs && this.$refs.canvas;
                if (!video || !canvas || !video.videoWidth) return;
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                var ctx = canvas.getContext('2d');
                if (!ctx) return;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                var self = this;
                canvas.toBlob(function (blob) {
                    if (!blob) return;
                    var id = nextId();
                    var url = URL.createObjectURL(blob);
                    self.captures.push({ id: id, blob: blob, url: url });
                    self._shotCount++;
                    self.burstCount = self._shotCount;
                }, 'image/jpeg', 0.85);
            },

            discardOne(id) {
                var idx = -1;
                for (var i = 0; i < this.captures.length; i++) {
                    if (this.captures[i].id === id) { idx = i; break; }
                }
                if (idx === -1) return;
                try { URL.revokeObjectURL(this.captures[idx].url); } catch (_) { /* ignore */ }
                this.captures.splice(idx, 1);
            },

            discardAll() {
                this.captures.forEach(function (c) { try { URL.revokeObjectURL(c.url); } catch (_) {} });
                this.captures = [];
                this._shotCount = 0;
                this.burstCount = 0;
            },

            async commit() {
                if (this.uploading || this.captures.length === 0 || !this._itemId) return;
                this.uploading = true;
                var editor = null;
                try {
                    var host = document.querySelector('[x-data*="inspectionEditor"]');
                    if (host && window.Alpine && typeof window.Alpine.$data === 'function') {
                        editor = window.Alpine.$data(host);
                    }
                } catch (_) { /* fall through */ }

                for (var i = 0; i < this.captures.length; i++) {
                    var cap = this.captures[i];
                    try {
                        if (editor && typeof editor._uploadBlobAsPhoto === 'function') {
                            await editor._uploadBlobAsPhoto(this._itemId, cap.blob);
                        } else {
                            await this._uploadDirect(this._itemId, cap.blob);
                        }
                    } catch (e) {
                        console.error('Burst upload failed:', e);
                        if (typeof showToast === 'function') showToast('Upload failed for one frame.', true);
                    }
                }
                this.close();
            },

            async _uploadDirect(itemId, blob) {
                // Fallback path when the inspectionEditor instance is not
                // reachable. Hits the same endpoint inspection-edit.js uses.
                var fd = new FormData();
                var fileName = 'burst-' + Date.now() + '.jpg';
                fd.append('file', blob, fileName);
                fd.append('itemId', itemId);
                var fetcher = (typeof window !== 'undefined' && typeof window.authFetch === 'function')
                    ? window.authFetch
                    : (typeof authFetch === 'function' ? authFetch : window.fetch.bind(window));
                var inspectionId = (window.__OI_INSPECTION_ID || (document.body && document.body.getAttribute('data-inspection-id')) || '').toString();
                if (!inspectionId) return;
                await fetcher('/api/inspections/' + encodeURIComponent(inspectionId) + '/upload', {
                    method: 'POST',
                    body: fd,
                });
            },

            _fallback(reason) {
                this.open = false;
                if (typeof showToast === 'function') showToast('Camera unavailable — opening file picker.');
                var input = document.getElementById('hotkey-photo-input');
                if (input) input.click();
            },
        };
    }

    function register() {
        if (typeof window === 'undefined' || !window.Alpine) return;
        try {
            window.Alpine.data('burstCamera', burstCameraFactory);
        } catch (_) { /* already registered */ }
    }
    // Guard so unit-test env (node, no document) can `import` this file.
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('alpine:init', register);
    }
    if (typeof window !== 'undefined' && window.Alpine && typeof window.Alpine.data === 'function') {
        register();
    }
})();
