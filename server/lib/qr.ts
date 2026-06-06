/**
 * QR rendering via qrcode's PURE internals (core encoder + svg-tag renderer).
 *
 * Why not `import QRCode from 'qrcode'`: the package's server entry
 * (`qrcode/lib/server`) statically requires the PNG renderer → `pngjs`, whose
 * module-level `util.inherits(..., zlib.Inflate)` crashes under the Vite dev
 * SSR runtime (`zlib.Inflate` is undefined in the workerd Node shims) —
 * "superCtor.prototype must be of type object". That single import was what
 * kept `npm run dev:hmr` broken. The deep imports below pull only pure JS
 * (no streams, no zlib), which runs identically in dev, workerd, and tests.
 *
 * We only ever render SVG (agreements verify QR, TOTP enrollment), so the PNG
 * pipeline was dead weight anyway. If a real PNG need appears, do the encode
 * with `fflate` (already a dependency) rather than resurrecting pngjs.
 */
import qrCore from 'qrcode/lib/core/qrcode';
import svgTagRenderer from 'qrcode/lib/renderer/svg-tag';

export interface QrSvgOptions {
    /** Quiet-zone size in modules (default 4, matching the qrcode package). */
    margin?: number;
    /** Rendered width/height in px (emitted as width/height attributes). */
    width?: number;
}

/** Render `text` as an SVG tag string — drop-in for `QRCode.toString(text, { type: 'svg', ...opts })`. */
export function qrToSvg(text: string, options: QrSvgOptions = {}): string {
    return svgTagRenderer.render(qrCore.create(text, {}), options);
}

/** Render `text` as a `data:image/svg+xml` URI suitable for an `<img src>` — replaces the PNG `QRCode.toDataURL`. */
export function qrToSvgDataUri(text: string, options: QrSvgOptions = {}): string {
    const svg = qrToSvg(text, options);
    return `data:image/svg+xml;base64,${btoa(svg)}`;
}
