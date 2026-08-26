import { defineConfig } from 'tsdown'

const id = 'dsh-telegram'
const clientExternals = ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@deepseek-ai/cordis']

export default defineConfig([
  {
    entry: ['src/index.ts'],
    outDir: 'dist',
    format: ['esm'],
    platform: 'node',
    target: 'node22.19.0',
    dts: true,
    clean: true,
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'dist',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: clientExternals,
      alwaysBundle: (specifier: string) => clientExternals.includes(specifier) ? undefined : true,
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
