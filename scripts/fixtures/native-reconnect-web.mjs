import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Unpacked, keyless browser fixture: the native Host owns all UI/session state.
export const name = 'evoforge-native-reconnect-fixture'
export const inject = ['llm', 'workspaceRegistry']

export async function apply(ctx, config) {
  const { LlmAdapter } = await import(pathToFileURL(
    join(config.dshSourceDir, 'packages/llm/llm/lib/index.js'),
  ).href)
  class Adapter extends LlmAdapter {
    async listModels() { return [{ id: 'reconnect-fixture', name: '重连验收（模拟模型）' }] }
    async resolveModel(provider, id) { return { provider, id, name: '重连验收（模拟模型）' } }
    async * stream() {
      const text = '原生会话已完成重连验收消息。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['reconnect-fixture'], new Adapter())
  await ctx.workspaceRegistry.create(config.workspacePath, 'EvoForge rc2 Reconnect')
}
