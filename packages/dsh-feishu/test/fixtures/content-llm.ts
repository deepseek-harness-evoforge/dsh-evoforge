import type { Context } from '@deepseek-ai/cordis'
import {
  ToolCallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

class FeishuContentAdapter extends LlmAdapter {
  readonly requests: Array<{
    readonly tools: GenerateOptions['tools']
    readonly system?: string
  }> = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async prepareCall(provider: string, model: string, _signal?: AbortSignal) {
    return {
      model: await this.resolveModel(provider, model),
      stream: (options: GenerateOptions) => this.stream(options),
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push({ tools: options.tools, ...(options.system === undefined ? {} : { system: options.system }) })
    const result = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (result === undefined) {
      const args = JSON.stringify({ kind: 'document', token_or_url: 'doxcnApproved123' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield {
        type: 'tool-call-delta', index: 0, id: ToolCallId('feishu-content-call'),
        name: 'feishu_content_read', argumentsDelta: args,
      }
      yield {
        type: 'block-end', index: 0,
        block: { type: 'tool-call', id: ToolCallId('feishu-content-call'), name: 'feishu_content_read', arguments: args },
      }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: `Approved Feishu content: ${text}` }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: `Approved Feishu content: ${text}` } }
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 5, cacheReadTokens: 2 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'dsh-feishu-content-llm'
export const inject = ['llm']

export function apply(ctx: Context): void {
  const adapter = new FeishuContentAdapter()
  ctx.llm.registerAdapter(['feishu-content-mock'], adapter)
  ctx.provide('evoforge.feishuContentLlm' as never, adapter as never)
}
