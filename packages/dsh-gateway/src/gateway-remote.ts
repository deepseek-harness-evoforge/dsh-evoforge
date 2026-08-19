import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { GatewayHealthSnapshot } from './client-types.ts'
import type { DshGateway } from './gateway.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Read-only, redacted Gateway projection consumed by optional DSH Web. */
    'evoforge.gatewayHealth': GatewayRemoteService
  }
}

/** Generated-Remote adapter over the existing Gateway authority. */
export class GatewayRemoteService extends TypertRemoteService {
  constructor(ctx: Context, private readonly gateway: DshGateway) {
    super(ctx, 'evoforge.gatewayHealth', { namespace: 'evoforgeGateway' })
    for (const initialize of remoteInitializers) initialize.call(this)
  }

  overview(): Promise<GatewayHealthSnapshot> {
    return Promise.resolve(this.gateway.healthSnapshot())
  }
}

type RemoteInitializer = (this: GatewayRemoteService) => void
type AnyRemoteMethod = (this: GatewayRemoteService, ...args: unknown[]) => unknown
const remoteInitializers: RemoteInitializer[] = []
const method = GatewayRemoteService.prototype.overview as AnyRemoteMethod
const context = {
  kind: 'method',
  name: 'overview',
  static: false,
  private: false,
  addInitializer(initializer: RemoteInitializer) { remoteInitializers.push(initializer) },
} as unknown as ClassMethodDecoratorContext<GatewayRemoteService, AnyRemoteMethod>
Remote('overview')(method, context)
