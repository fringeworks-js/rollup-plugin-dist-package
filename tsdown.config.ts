import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: false,
  unbundle: true,
  clean: true,
  outDir: 'dist',
  minify: false,
  deps: {
    onlyBundle: false,
  },
});
