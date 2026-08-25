import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  GatewayHealthSnapshot,
  GatewayPairingRevocationReceipt,
  GatewayPairingSessionApprovalReceipt,
} from './client-types.ts'

/** Static-only contract consumed by the pinned DSH Typert generator. */
export class GatewayRemoteTypertContract extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'evoforge.gatewayHealth', { namespace: 'evoforgeGateway' })
  }

  @Remote
  overview(): Promise<GatewayHealthSnapshot> {
    throw new Error('static Typert contract')
  }

  @Remote
  approvePairing(
    _code: string,
    _adapter: string,
    _workspaceId: string,
    _sessionId: string,
  ): Promise<GatewayPairingSessionApprovalReceipt> {
    throw new Error('static Typert contract')
  }

  @Remote
  revokePairing(_routeId: string): Promise<GatewayPairingRevocationReceipt> {
    throw new Error('static Typert contract')
  }
}
