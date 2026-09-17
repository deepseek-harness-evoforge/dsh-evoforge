import { createRequire } from 'node:module'
import { defineConfig } from 'vitest/config'

const require = createRequire(import.meta.url)

// The published native store keeps its engine imports external (the Web Host supplies them).
// Tests run the same engine with the versions locked by the audited Host, without bundling it in our Client.
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(['zustand/vanilla', 'zustand/middleware', 'zustand/shallow', 'immer']
      .map(name => [name, require.resolve(name)])),
  },
  test: { server: { deps: { inline: ['@deepseek-ai/dsh-client-store'] } } },
})
