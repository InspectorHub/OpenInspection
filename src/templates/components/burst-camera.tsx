/**
 * S3-6 — AI burst photo capture modal.
 *
 * Full-screen, dark camera surface mounted once at the bottom of the
 * inspection-edit page. Visibility, lifecycle, and shutter logic live in
 * `public/js/burst-camera.js` (Alpine factory `burstCamera`).
 *
 * UX:
 *   - Live preview from `getUserMedia({ video: { facingMode: ... } })`.
 *   - Single tap on the shutter = single photo.
 *   - Long-press (≥ 200 ms) = burst capture, capped at 30 frames @ 10 fps.
 *   - Bottom strip shows captured thumbnails. "Done" uploads them all,
 *     "Discard" cancels. Per-thumbnail discard via the small `×` button.
 *   - If `getUserMedia` is unavailable or rejected, the modal closes
 *     and falls back to the existing native file picker
 *     (`#hotkey-photo-input`).
 *
 * Design tokens (Sprint 1): rose-500 burst counter, slate-900 chrome
 * background, indigo accent for the Done button. The page gets
 * `overflow-hidden` while open so the live feed is the only surface.
 */
export const BurstCamera = (): JSX.Element => (
    <div
        x-data="burstCamera"
        x-show="open"
        {...{
            'x-cloak': '',
            'x-on:keydown.escape.window': 'if (open) close()',
        }}
        class="fixed inset-0 z-50 bg-black flex flex-col"
        role="dialog"
        aria-label="Burst camera"
        aria-modal="true"
        style="display: none"
    >
        {/* Live preview. `playsinline` keeps iOS Safari from going full screen. */}
        <video
            x-ref="video"
            autoplay
            muted
            playsinline
            class="absolute inset-0 w-full h-full object-cover"
        ></video>
        <canvas x-ref="canvas" class="hidden"></canvas>

        {/* Top chrome — close + facing toggle. */}
        <div class="relative z-10 flex items-center justify-between px-4 pt-4">
            <button
                type="button"
                x-on:click="close()"
                class="w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition"
                aria-label="Close camera"
                title="Close (Esc)"
            >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
            <div class="text-white text-xs font-mono px-3 py-1 rounded-full bg-black/40" x-show="captures.length > 0">
                <span x-text="captures.length"></span> captured
            </div>
            <button
                type="button"
                x-on:click="switchFacing()"
                class="w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition"
                aria-label="Switch camera"
                title="Switch camera"
            >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114-3M20 15a8 8 0 01-14 3" />
                </svg>
            </button>
        </div>

        {/* Spacer pushes shutter row to the bottom. */}
        <div class="flex-1"></div>

        {/* Captured thumbnail strip. Horizontally scrollable when > 8 frames. */}
        <div
            x-show="captures.length > 0"
            class="relative z-10 mb-3 px-4"
            style="display: none"
        >
            <div class="flex gap-2 overflow-x-auto pb-1" data-testid="burst-thumbnails">
                <template x-for="(c, ci) in captures" x-bind:key="c.id">
                    <div class="relative flex-shrink-0">
                        <img
                            x-bind:src="c.url"
                            class="w-16 h-16 object-cover rounded-md border-2 border-white/30"
                            alt="Captured frame"
                        />
                        <button
                            type="button"
                            x-on:click="discardOne(c.id)"
                            class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center hover:bg-rose-600"
                            aria-label="Discard this frame"
                        >×</button>
                    </div>
                </template>
            </div>
        </div>

        {/* Bottom action row — discard / shutter / done. */}
        <div class="relative z-10 pb-8 px-4 flex items-center justify-between gap-4">
            <button
                type="button"
                x-on:click="discardAll()"
                x-show="captures.length > 0"
                style="display: none"
                class="text-rose-300 text-xs font-semibold hover:text-rose-200 transition"
                aria-label="Discard all captures"
            >
                Discard all
            </button>
            <div x-show="captures.length === 0" class="w-20" aria-hidden="true"></div>

            {/* Shutter — tap = single shot, hold = burst. */}
            <button
                type="button"
                x-on:mousedown="onShutterDown($event)"
                x-on:mouseup="onShutterUp($event)"
                x-on:mouseleave="onShutterCancel()"
                {...{
                    'x-on:touchstart.prevent': 'onShutterDown($event)',
                    'x-on:touchend.prevent': 'onShutterUp($event)',
                    'x-on:touchcancel.prevent': 'onShutterCancel()',
                }}
                class="w-20 h-20 rounded-full bg-white border-4 transition flex items-center justify-center"
                x-bind:class="burstActive ? 'border-rose-500 scale-110' : 'border-white/40 hover:scale-105'"
                aria-label="Capture (tap for single, hold for burst)"
                data-testid="burst-shutter"
            >
                <span x-show="!burstActive" class="text-slate-700 text-[10px] font-bold tracking-widest uppercase">Shoot</span>
                <span
                    x-show="burstActive"
                    style="display: none"
                    class="text-rose-600 text-xs font-bold animate-pulse"
                    x-text="burstCount + ' / 30'"
                ></span>
            </button>

            <button
                type="button"
                x-on:click="commit()"
                x-show="captures.length > 0"
                style="display: none"
                class="px-5 py-2.5 rounded-full bg-indigo-500 text-white text-sm font-bold shadow-lg hover:bg-indigo-600 transition"
                aria-label="Upload captures"
                data-testid="burst-done"
            >
                <span x-text="uploading ? 'Uploading…' : 'Done'"></span>
            </button>
            <div x-show="captures.length === 0" class="w-20" aria-hidden="true"></div>
        </div>
    </div>
);
