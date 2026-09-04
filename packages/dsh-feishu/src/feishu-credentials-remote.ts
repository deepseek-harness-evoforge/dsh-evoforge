import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

/** Public, non-secret names used by the Feishu Web credential form. */
export interface FeishuCredentialReferences {
  readonly appIdRef: string
  readonly appSecretRef: string
}

/** Host-owned projection of the configured Feishu credential references. */
export class FeishuCredentialRemoteService extends TypertRemoteService {
  constructor(ctx: Context, private readonly refs: FeishuCredentialReferences) {
    super(ctx, 'evoforge.feishuCredentials', { namespace: 'evoforgeFeishu' })
    for (const initialize of remoteInitializers) initialize.call(this)
  }

  references(): Promise<FeishuCredentialReferences> {
    return Promise.resolve(this.refs)
  }
}

type RemoteInitializer = (this: FeishuCredentialRemoteService) => void
type AnyRemoteMethod = (this: FeishuCredentialRemoteService, ...args: unknown[]) => unknown
const remoteInitializers: RemoteInitializer[] = []
const method = FeishuCredentialRemoteService.prototype.references as AnyRemoteMethod
const context = {
  kind: 'method',
  name: 'references',
  static: false,
  private: false,
  addInitializer(initializer: RemoteInitializer) { remoteInitializers.push(initializer) },
} as unknown as ClassMethodDecoratorContext<FeishuCredentialRemoteService, AnyRemoteMethod>
Remote('references')(method, context)
