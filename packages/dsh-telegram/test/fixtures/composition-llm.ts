import { appendFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const OFF = ReasoningEffortId('off')

class CompositionRecorder extends LlmAdapter {
  private readonly output: string

  constructor(output: string) {
    super()
    this.output = output
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: { efforts: [{ id: OFF, name: 'Off' }], defaultEffort: OFF },
    }
  }

  async prepareCall(provider: string, model: string, _signal?: AbortSignal) {
    return {
      model: await this.resolveModel(provider, model),
      stream: (options: GenerateOptions) => this.stream(options),
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const { signal: _signal, ...composition } = options
    appendFileSync(this.output, `${JSON.stringify(composition)}\n`, 'utf8')
    const reply = 'composition recorded'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'dsh-telegram-composition-llm'
export const inject = ['llm']

export function apply(ctx: Context, config: { readonly output: string }): void {
  if (typeof config.output !== 'string' || config.output.length === 0) {
    throw new Error('composition recorder requires output')
  }
  ctx.llm.registerAdapter(['composition-recorder'], new CompositionRecorder(config.output))
}
