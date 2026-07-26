import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  future: {
    v8_viteEnvironmentApi: true,
    // "enforce" rather than true: a route module that cannot be split fails the
    // build instead of silently falling back, so the cost shows up now rather
    // than as a mystery bundle regression later.
    v8_splitRouteModules: "enforce",
    // Data requests move from /_root.data to /_.data. Nothing in either app
    // hardcodes those paths; the exposure here is the worker entry's path
    // routing, which must not hand the new shape to the Hono API app.
    v8_trailingSlashAwareDataRequests: true,
    // Loaders/actions receive the raw request; `request.url` now carries the
    // `.data` suffix and internal search params. Every site that read a
    // pathname off it was moved to the normalized `url` arg beforehand, and no
    // code iterates searchParams (which is where the internal entries surface).
    v8_passThroughRequests: true,
    // The load context becomes a RouterContextProvider addressed by typed keys
    // instead of a plain object. Every read already goes through
    // app/lib/load-context.ts, so this is one edit rather than forty.
    v8_middleware: true,
  },
} satisfies Config;
