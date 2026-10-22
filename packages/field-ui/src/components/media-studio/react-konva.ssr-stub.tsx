/**
 * SSR stand-in for `react-konva`, wired up in `vite.config.ts` for the `ssr`
 * environment only. The client build gets the real library.
 *
 * Why this exists: konva is a canvas library. `PhotoAnnotator` — its only
 * consumer — already gates every render behind a client-only `mounted` flag
 * ("konva touches the DOM"), so none of this code can execute on the server.
 * But the import still sat in the route's module graph, so konva, react-konva,
 * react-reconciler and normalize-wheel were all bundled into the WORKER.
 *
 * That matters because OpenInspection promises one-click deploys on Workers
 * Free, whose script limit is 3 MiB gzipped, and the worker had drifted to the
 * ceiling (see `npm run check:bundle`). Splitting the import with `React.lazy`
 * would not have helped — every emitted chunk still counts toward the upload;
 * the module has to leave the server graph entirely, which is what an
 * environment-scoped alias does.
 *
 * The exports below are the ones `PhotoAnnotator` names. Each renders nothing.
 * If one of them ever DOES render on the server, that is a bug in the caller's
 * client-only gate, not something this file should paper over — you would see
 * an annotator that silently draws nothing after hydration.
 */
import type { ReactNode } from "react";

/** Every konva element the annotator uses collapses to the same inert node. */
function Inert(_props: { children?: ReactNode; [key: string]: unknown }): null {
    return null;
}

export const Stage = Inert;
export const Layer = Inert;
export const Image = Inert;
export const Circle = Inert;
export const Arrow = Inert;
export const Line = Inert;
export const Label = Inert;
export const Tag = Inert;
export const Text = Inert;
