import { defineConfig } from 'tsdown'
import { join } from 'node:path'

export default defineConfig({
  entry: { 'evaluator-browser': join(import.meta.dirname, 'evaluator-browser.tsx') },
  outDir: process.env.EVOFORGE_BROWSER_OUT ?? '.browser-acceptance',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  clean: true,
  dts: false,
  sourcemap: false,
  deps: { alwaysBundle: () => true },
})
