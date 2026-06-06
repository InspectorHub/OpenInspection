// Deep-import declarations for qrcode's pure internals (see server/lib/qr.ts
// for why we bypass the package's server entry: its PNG renderer drags in
// pngjs, which crashes the Vite dev SSR runtime at module scope).
// @types/qrcode only types the top-level entry, so the two internal modules
// we consume are declared here with just the surface we use.

declare module 'qrcode/lib/core/qrcode' {
    import type { QRCode, QRCodeOptions } from 'qrcode';
    const core: { create(text: string, options: QRCodeOptions): QRCode };
    export default core;
}

declare module 'qrcode/lib/renderer/svg-tag' {
    import type { QRCode } from 'qrcode';
    const renderer: {
        render(qrData: QRCode, options?: { margin?: number; width?: number }): string;
    };
    export default renderer;
}
