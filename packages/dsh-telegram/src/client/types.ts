import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandDescriptor, CommandExecution } from '@deepseek-ai/dsh-commands/types'

export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

export interface TelegramCommandsClient {
  list(sessionId: SessionId): Promise<RemoteResult<readonly CommandDescriptor[]>>
  execute(sessionId: SessionId, line: string, images?: readonly never[]): Promise<RemoteResult<CommandExecution | undefined>>
}
