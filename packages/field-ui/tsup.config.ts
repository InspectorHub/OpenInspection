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
});
