import { defineConfig } from 'tsdown'

export default defineConfig({
  // Bundle TypeScript's emitted JavaScript so standard decorators are lowered
  // before the package reaches plain Node. Direct TS bundling preserves the
  // decorator tokens and produces an unloadable npm artifact.
  entry: ['lib/types/client.js', 'lib/types/index.js'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  dts: false,
  clean: true,
})
