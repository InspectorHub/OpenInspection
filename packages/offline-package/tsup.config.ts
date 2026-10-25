import { defineConfig } from 'tsup';

// One entry. `fflate` and `zod` are peers, so tsup leaves them external and the host owns
// a single copy of each. The source imports nothing else (no `@core/` alias), which
// `npm run lint:package-tarball` re-checks on the staged output.
export default defineConfig({
  entry: { index: 'index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
});
