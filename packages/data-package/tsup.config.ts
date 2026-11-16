import { defineConfig } from 'tsup';

// One entry. `zod` is a peer, so tsup leaves it external and the host owns a single
// copy. The source imports nothing else (no `@core/` alias), which
// `npm run lint:package-tarball` re-checks on the staged output.
export default defineConfig({
  entry: { index: 'index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
});
