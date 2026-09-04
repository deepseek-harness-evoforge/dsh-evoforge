import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { FeishuCredentialReferences } from './client-types.js'

/** Static-only contract consumed by the pinned DSH Typert generator. */
export class FeishuCredentialRemoteTypertContract extends TypertRemoteService {
  constructor(ctx: import('@deepseek-ai/cordis').Context) {
    super(ctx, 'evoforge.feishuCredentials', { namespace: 'evoforgeFeishu' })
  }

  @Remote
  references(): Promise<FeishuCredentialReferences> {
    throw new Error('static Typert contract')
  }
}
