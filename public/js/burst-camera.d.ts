/**
 * S3-6 — burst-camera helpers re-exported for unit tests.
 *
 * The actual file is plain JS (loaded as a <script> in the browser);
 * this declaration surfaces the timing constants + pure helper used
 * by `tests/unit/burst-camera-timing.spec.ts`.
 */
export declare const LONG_PRESS_MS: number;
export declare const BURST_FPS: number;
export declare const MAX_BURST_FRAMES: number;
export declare const BURST_INTERVAL_MS: number;
export declare function burstFrameCount(heldMs: number): number;
