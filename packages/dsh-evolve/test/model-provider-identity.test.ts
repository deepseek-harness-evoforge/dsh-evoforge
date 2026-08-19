import { describe, expect, it } from 'vitest'
import { boundedModelProviderIdentity } from '../src/model-provider-identity.ts'

describe('bounded model provider identity', () => {
  it('normalizes the endpoint spelling shared by proposer and governance', () => {
    expect(boundedModelProviderIdentity(' https://provider.example.test/v1/ ', ' shared-model '))
      .toBe(boundedModelProviderIdentity('https://provider.example.test/v1', 'shared-model'))
  })
})
