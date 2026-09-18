/**
 * Read-only upstream regression probe. Appends one test to DSH's own client
 * harness in Vite memory; does not edit, build, or launch the DSH checkout.
 * Run from the audited DSH root, using its existing dependencies:
 * pnpm exec vitest run packages/client/ui-chat/tests/chat-view.client.spec.tsx \
 *   --config <evoforge>/scripts/repro-dsh-approval-status.config.mjs \
 *   -t 'EvoForge upstream:' --maxWorkers 1
 * Expected on affected DSH: exit 1, deep-diving status remains visible.
 */
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = realpathSync(process.cwd())
const config = (await import(pathToFileURL(resolve(root, 'vitest.config.ts')).href)).default
const target = resolve(root, 'packages/client/ui-chat/tests/chat-view.client.spec.tsx')
const extraTest = `
import { PendingApproval as EvoforgePendingApproval } from '../../ui-approval/src/client/contract/slots.ts'
it('EvoForge upstream: ordinary execution keeps its active status', () => {
  const h = makeHarness({ runningCalls: [runningCall('ordinary-call')] }, { running: true })
  const view = render(<h.ChatView {...h.props} />)
  expect(view.getByRole('status').textContent).toContain('深度求索中')
})
it('EvoForge upstream: another session approval must not suppress active status', () => {
  const h = makeHarness({ runningCalls: [runningCall('ordinary-call')] }, { running: true })
  h.props.useSessionPendingInteraction = bindSnapshotSelector(createSnapshotStore(new Map([
    ['other-session', new EvoforgePendingApproval('other-session', {
      toolName: 'bash', callId: 'other-call', reason: 'Another session' })],
  ])))
  const view = render(<h.ChatView {...h.props} />)
  expect(view.getByRole('status').textContent).toContain('深度求索中')
})
it('EvoForge upstream: pending approval must not announce active deep-diving', () => {
  const h = makeHarness({ runningCalls: [runningCall('approval-call')] }, { running: true })
  // The same native PendingApproval class used by the UI publisher.
  h.props.useSessionPendingInteraction = bindSnapshotSelector(createSnapshotStore(new Map([
    [SID, new EvoforgePendingApproval(SID, {
      toolName: 'bash', callId: 'approval-call', reason: 'Create one test file' })],
  ])))
  const view = render(<h.ChatView {...h.props} />)
  expect(view.getByTestId('tool-seat-approval-call')).toBeTruthy()
  expect(view.queryByRole('status')?.textContent ?? '').not.toContain('深度求索中')
})
`

const probe = () => ({
  name: 'evoforge-upstream-approval-status-reproduction',
  enforce: 'pre',
  transform(code, id) {
    if (id.split('?')[0] !== target) return null
    if (!code.includes('function makeHarness(') || !code.includes('const runningCall =')) {
      throw new Error('Native test harness changed; review the probe before running it.')
    }
    return { code: code + extraTest, map: null }
  },
})

config.plugins = [...(config.plugins ?? []), probe()]
for (const project of config.test?.projects ?? []) {
  if (typeof project !== 'object' || project === null) continue
  project.plugins = [...(project.plugins ?? []), probe()]
}
export default config
