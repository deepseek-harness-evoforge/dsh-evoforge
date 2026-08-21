import { describe, expect, it, vi } from 'vitest'
import { readOfficialFeishuContent, resolveFeishuTransport } from '../src/platform.js'

describe('official Feishu content reader', () => {
  it('maps document raw content to a bounded result', async () => {
    const client = fakeClient()
    client.docx.v1.document.get.mockResolvedValue({
      code: 0,
      data: { document: { title: 'Design', revision_id: 7, document_id: 'must-not-leak' } },
    })
    client.docx.v1.document.rawContent.mockResolvedValue({
      code: 0,
      data: { content: 'abcdef' },
    })

    await expect(readOfficialFeishuContent(client, {
      kind: 'document', token: 'doxcnDoc123', maxContentChars: 4, maxBitableRecords: 20,
    }, new AbortController().signal)).resolves.toEqual({
      schemaVersion: 1,
      kind: 'document',
      title: 'Design',
      objectType: 'docx',
      revision: 7,
      contentFormat: 'text/plain',
      content: 'abcd',
      truncated: true,
    })
  })

  it('resolves a Wiki node and reads its underlying docx without returning identities or URLs', async () => {
    const client = fakeClient()
    client.wiki.v2.space.getNode.mockResolvedValue({
      code: 0,
      data: { node: {
        title: 'Runbook', obj_type: 'docx', obj_token: 'doxcnUnderlying',
        owner: 'ou_secret', creator: 'ou_secret', url: 'https://secret.invalid',
      } },
    })
    client.docx.v1.document.rawContent.mockResolvedValue({ code: 0, data: { content: 'safe runbook' } })

    const result = await readOfficialFeishuContent(client, {
      kind: 'wiki', token: 'wikcnNode123', maxContentChars: 100, maxBitableRecords: 20,
    }, new AbortController().signal)

    expect(result).toMatchObject({
      kind: 'wiki', title: 'Runbook', objectType: 'docx', content: 'safe runbook', truncated: false,
    })
    expect(JSON.stringify(result)).not.toContain('ou_secret')
    expect(JSON.stringify(result)).not.toContain('secret.invalid')
    expect(JSON.stringify(result)).not.toContain('doxcnUnderlying')
  })

  it('returns only bounded Drive metadata, excluding owner, URL, and resource tokens', async () => {
    const client = fakeClient()
    client.drive.v1.meta.batchQuery.mockResolvedValue({
      code: 0,
      data: { metas: [{
        doc_token: 'boxcnSecret', doc_type: 'file', title: 'Plan.pdf', owner_id: 'ou_secret',
        create_time: '10', latest_modify_user: 'ou_other', latest_modify_time: '20',
        url: 'https://secret.invalid', sec_label_name: 'restricted',
      }] },
    })

    const result = await readOfficialFeishuContent(client, {
      kind: 'drive', token: 'boxcnSecret', driveType: 'file', maxContentChars: 100, maxBitableRecords: 20,
    }, new AbortController().signal)

    expect(result).toEqual({
      schemaVersion: 1,
      kind: 'drive',
      title: 'Plan.pdf',
      objectType: 'file',
      createdAt: '10',
      modifiedAt: '20',
      classification: 'restricted',
      truncated: false,
    })
    expect(JSON.stringify(result)).not.toContain('boxcnSecret')
    expect(JSON.stringify(result)).not.toContain('ou_secret')
    expect(JSON.stringify(result)).not.toContain('secret.invalid')
  })

  it('reads a bounded page of Bitable records without collaborator or record URLs', async () => {
    const client = fakeClient()
    client.bitable.v1.app.get.mockResolvedValue({
      code: 0,
      data: { app: { name: 'Cases', revision: 9, app_token: 'bascnSecret', is_advanced: true } },
    })
    client.bitable.v1.appTableRecord.search.mockResolvedValue({
      code: 0,
      data: {
        items: [{
          record_id: 'rec1', fields: { Name: 'Alpha' },
          created_by: { id: 'ou_secret', email: 'secret@example.invalid' },
          record_url: 'https://secret.invalid',
        }],
        total: 1,
        has_more: false,
      },
    })

    const result = await readOfficialFeishuContent(client, {
      kind: 'bitable', token: 'bascnSecret', tableId: 'tblCases', pageSize: 1,
      maxContentChars: 1_024, maxBitableRecords: 20,
    }, new AbortController().signal)

    expect(result).toMatchObject({
      schemaVersion: 1,
      kind: 'bitable',
      title: 'Cases',
      objectType: 'bitable',
      revision: 9,
      contentFormat: 'application/json',
      content: '[{"recordId":"rec1","fields":{"Name":"Alpha"}}]',
      returnedItems: 1,
      totalItems: 1,
      hasMore: false,
      truncated: false,
    })
    expect(JSON.stringify(result)).not.toContain('ou_secret')
    expect(JSON.stringify(result)).not.toContain('secret.invalid')
    expect(JSON.stringify(result)).not.toContain('bascnSecret')
  })

  it('fails with a stable safe message and forwards AbortSignal into official HTTP calls', async () => {
    const client = fakeClient()
    client.docx.v1.document.get.mockResolvedValue({ code: 999, msg: 'secret raw provider detail' })
    await expect(readOfficialFeishuContent(client, {
      kind: 'document', token: 'doxcnDoc123', maxContentChars: 100, maxBitableRecords: 20,
    }, new AbortController().signal)).rejects.toThrow('Feishu rejected the content read')
    await expect(readOfficialFeishuContent(client, {
      kind: 'document', token: 'doxcnDoc123', maxContentChars: 100, maxBitableRecords: 20,
    }, AbortSignal.abort(new Error('stop')))).rejects.toThrow('stop')

    const transport = resolveFeishuTransport({})
    const callSignal = new AbortController().signal
    let observed: AbortSignal | undefined
    transport.httpInstance.interceptors.request.use((config) => {
      observed = config.signal as AbortSignal | undefined
      return Promise.reject(new Error('captured before network'))
    })
    await expect(transport.withSignal(callSignal, () =>
      transport.httpInstance.get('https://open.feishu.cn/never-sent'))).rejects.toThrow('captured before network')
    expect(observed).toBe(callSignal)
  })
})

function fakeClient() {
  return {
    docx: { v1: { document: { get: vi.fn(), rawContent: vi.fn() } } },
    wiki: { v2: { space: { getNode: vi.fn() } } },
    drive: { v1: { meta: { batchQuery: vi.fn() } } },
    bitable: { v1: { app: { get: vi.fn() }, appTableRecord: { search: vi.fn() } } },
  }
}
