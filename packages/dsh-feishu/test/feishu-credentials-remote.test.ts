import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import { FeishuCredentialRemoteService } from '../src/feishu-credentials-remote.js'

describe('FeishuCredentialRemoteService', () => {
  it('projects only configured reference names and no secret values', async () => {
    const ctx = new Context()
    const service = new FeishuCredentialRemoteService(ctx, {
      appIdRef: 'CUSTOM_FEISHU_ID',
      appSecretRef: 'CUSTOM_FEISHU_SECRET',
    })

    await expect(service.references()).resolves.toEqual({
      appIdRef: 'CUSTOM_FEISHU_ID',
      appSecretRef: 'CUSTOM_FEISHU_SECRET',
    })
    expect(ctx.get('evoforge.feishuCredentials')).toMatchObject({ name: 'evoforge.feishuCredentials' })
    expect(service.typertRemote).toMatchObject({
      serviceKey: 'evoforge.feishuCredentials',
      namespace: 'evoforgeFeishu',
    })
    expect(remoteMethods(service).map(marker => marker.method)).toEqual(['references'])
  })
})
