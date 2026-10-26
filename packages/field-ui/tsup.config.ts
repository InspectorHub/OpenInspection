import { copyFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// One published artifact: @core/shared-ui is bundled in, React and Yjs stay
// peers so the host application owns a single copy of each.
export default defineConfig({
  // `testing` is the in-memory data source for host test suites; it is a
  // separate entry so the editor's production surface never carries it.
  entry: { index: 'src/index.ts', testing: 'src/testing/fake-data-source.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['react', 'react-dom', 'yjs'],
  noExternal: ['@core/shared-ui'],
  // The theme layer is plain CSS that the host's Tailwind compiles (it holds
  // `@theme` blocks), so it ships as a file rather than going through esbuild.
  // `dist/theme.css` is the `./theme.css` export.
  // `react-photo-album/rows.css` and `yet-another-react-lightbox/styles.css` are
  // not copied: both libraries are peers, so the bare side-effect imports in
  // `dist/index.js` are left for the host bundler to resolve from its own copy.
  onSuccess: async () => {
    copyFileSync('src/theme.css', 'dist/theme.css');
  },
});
