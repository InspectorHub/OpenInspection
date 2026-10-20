import { defineConfig } from 'tsup';

// One published artifact: @core/shared-ui is bundled in, React and Yjs stay
// peers so the host application owns a single copy of each.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['react', 'react-dom', 'yjs'],
  noExternal: ['@core/shared-ui'],
});
