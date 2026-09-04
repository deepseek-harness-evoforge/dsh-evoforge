import { execFile as execFileCallback, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  chmod,
  mkdir,
  readFile,
  realpath,
  readdir,
  rename,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  assertRealFeishuTerminalReport,
  BENCHMARK_ID,
  hasExactNativeScheduleRoundTrip,
  type RealFeishuAcceptanceResolution,
  type RealFeishuExecutionConfig,
  type RealFeishuTerminalReport,
} from './contract.ts'

const execFile = promisify(execFileCallback)
const benchmarkRoot = dirname(fileURLToPath(import.meta.url))
const suiteRoot = resolve(benchmarkRoot, '../../..')
const RESULT_FILE = 'result.json'
const STATE_FILE = 'state.json'
const PROFILE_NAME = 'web'
const SEED_ROUTE_ID = 'as2-native-session-seed'
const SESSION_ID = 'evoforge-feishu-as2-real'

type ReadyReport = Extract<RealFeishuAcceptanceResolution, { status: 'ready' }>['report']
type ApprovalOutcome = 'allowed-once' | 'allowed-always' | 'denied' | 'unavailable' | 'cancelled'

interface GatewayHealthSnapshot {
  readonly lifecycle: 'starting' | 'ready' | 'stopping'
  readonly routes: { readonly liveSessions: number }
  readonly ingress: { readonly settled: number; readonly uncertain: number }
  readonly transports: { readonly ready: number; readonly degraded: number }
  readonly outbound: {
    readonly delivered: number
    readonly uncertain: number
    readonly failed: number
  }
}

interface RuntimeGateway {
  healthSnapshot(observedAt?: number, routeIds?: readonly string[]): GatewayHealthSnapshot
  resolve(id: string, signal?: AbortSignal): Promise<RuntimeAgent>
  route(id: string): {
    readonly id: string
    readonly adapter: string
    readonly accountId: string
    readonly conversationId: string
    readonly threadId?: string
    readonly userId: string
    readonly workspaceId: string
    readonly sessionId: string
  } | undefined
  pendingPairings(observedAt?: number): readonly {
    readonly requestId: string
    readonly adapter: string
    readonly accountIdHash: string
    readonly createdAt: number
    readonly expiresAt: number
  }[]
  approvePairingRequestForSession(input: {
    readonly requestId: string
    readonly workspaceId: string
    readonly sessionId: string
  }): Promise<{ readonly routeId: string; readonly workspaceId: string; readonly sessionId: string }>
}

type AcceptanceReport = RealFeishuTerminalReport

interface AcceptanceState {
  readonly schemaVersion: 1
  readonly benchmarkId: typeof BENCHMARK_ID
  readonly manifestHash: string
  readonly revisions: { readonly evoforge: string; readonly deepseekHarness: string }
  readonly appIdentityHash: string
  readonly chatKind: 'direct'
  readonly challenge: string
  readonly stage: string
  readonly updatedAt: string
}

interface RuntimeContext {
  readonly fiber: { dispose(): Promise<void> }
  readonly agents: {
    get(id: unknown): RuntimeAgent | undefined
    withInitiator<T>(agent: RuntimeAgent, operation: () => Promise<T>): Promise<T>
  }
  readonly sessions: { flush(session: unknown): Promise<void> }
  readonly sessionPersistence: { load(id: unknown): Promise<{ events: readonly RuntimeEvent[] }> }
  readonly tools: {
    get(name: string, agent: RuntimeAgent): unknown
    execute(input: {
      readonly signal: AbortSignal
      readonly callId: string
      readonly name: string
      readonly arguments: unknown
      readonly agent: RuntimeAgent
    }): Promise<{ readonly isError?: boolean }>
  }
  readonly workspaceRegistry: {
    create(path: string): Promise<{ readonly id: unknown }>
  }
  get(name: string): unknown
}

interface RuntimeAgent {
  readonly session: {
    readonly snapshotEvents?: () => readonly RuntimeEvent[]
    readonly events?: readonly RuntimeEvent[]
  }
  whenIdle(): Promise<void>
}

interface RuntimeEvent {
  readonly type: string
  readonly data?: unknown
}

interface FeishuHostRoute {
  readonly routes: readonly { readonly routeId: string; readonly workspaceId: string }[]
  observedChatKind(routeId: string): 'direct' | 'group' | undefined
  notify(notice: { readonly id: string; readonly routeId: string; readonly text: string }): Promise<{
    readonly created: boolean
    readonly status: string
  }>
}

/**
 * Run one human-in-the-loop real Feishu epoch through final packed Bundles.
 * No platform fake is accepted here; the only keyless adapter is the DSH LLM
 * fixture, which isolates channel delivery from paid model behavior.
 */
export async function executeRealFeishuAcceptance(
  config: RealFeishuExecutionConfig,
  preflight: ReadyReport,
): Promise<AcceptanceReport> {
  const manifestSource = await readFile(join(benchmarkRoot, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(manifestSource) as {
    readonly id: string
    readonly scope: string
    readonly revisions: { readonly deepseekHarness: string }
  }
  if (manifest.id !== BENCHMARK_ID || !/^[a-f0-9]{40}$/u.test(manifest.revisions.deepseekHarness)) {
    throw new Error('AS-2 manifest identity is invalid')
  }
  const manifestHash = sha256(manifestSource)
  const [evoforgeRevision, dshRevision, evoforgeDirty, dshDirty] = await Promise.all([
    git(suiteRoot, 'rev-parse', 'HEAD'),
    git(config.dshSourceDir, 'rev-parse', 'HEAD'),
    git(suiteRoot, 'status', '--porcelain'),
    git(config.dshSourceDir, 'status', '--porcelain'),
  ])
  if (evoforgeDirty !== '') throw new Error('AS-2 requires a clean EvoForge revision before real effects')
  if (dshDirty !== '') throw new Error('AS-2 requires a clean DSH checkout before real effects')
  if (dshRevision !== manifest.revisions.deepseekHarness) {
    throw new Error(`AS-2 DSH revision mismatch: expected ${manifest.revisions.deepseekHarness}, got ${dshRevision}`)
  }
  await assertDshBuild(config.dshSourceDir)

  const root = await exactDirectory(config.runRoot)
  const runId = sha256(JSON.stringify([
    BENCHMARK_ID,
    manifestHash,
    evoforgeRevision,
    dshRevision,
    preflight.appIdentityHash,
  ]))
  const runDir = await exactDirectory(join(root, BENCHMARK_ID, runId))
  const resultPath = join(runDir, RESULT_FILE)
  const statePath = join(runDir, STATE_FILE)
  const previous = await readJson<unknown>(resultPath)
  if (previous !== undefined) {
    assertRealFeishuTerminalReport(previous, { manifestHash, evoforgeRevision, dshRevision, preflight })
    return previous
  }
  if (await exists(statePath)) {
    return failureBase(manifest.scope, manifestHash, evoforgeRevision, dshRevision, preflight,
      'prior-nonterminal-real-effects-require-a-new-run-root-after-manual-audit')
  }

  const challenge = `EVOFORGE-AS2-${runId.slice(0, 16)}`
  const stateBase: Omit<AcceptanceState, 'stage' | 'updatedAt'> = {
    schemaVersion: 1 as const,
    benchmarkId: BENCHMARK_ID,
    manifestHash,
    revisions: { evoforge: evoforgeRevision, deepseekHarness: dshRevision },
    appIdentityHash: preflight.appIdentityHash,
    chatKind: preflight.chatKind,
    challenge,
  }
  let stage = 'prepared'
  let context: RuntimeContext | undefined
  let restoreRuntimeEnvironment: (() => void) | undefined
  let observations = emptyObservations()
  let gatewayFacts: AcceptanceReport['gateway']
  let routeIdentityHash: string | undefined
  await writeState(statePath, stateBase, stage)
  try {
    const dshHome = join(runDir, 'dsh-home')
    const profileDir = join(dshHome, 'profiles', PROFILE_NAME)
    const workspacePath = await exactDirectory(join(runDir, 'workspace'))
    const env = await acceptanceEnvironment(config, dshHome, runDir)
    const dshBin = join(config.dshSourceDir, 'apps', 'cli', 'lib', 'bin.js')

    stage = 'packing-final-bundles'
    await writeState(statePath, stateBase, stage)
    const tarballs = await packFinalBundles(runDir)
    await assertPackedBoundary(tarballs)

    stage = 'clean-profile-install'
    await writeState(statePath, stateBase, stage)
    await runDsh(dshBin, [
      'plugin', '--profile', PROFILE_NAME, 'add',
      tarballs.control,
      tarballs.gateway,
      tarballs.feishu,
      '--prefer-offline', '--ignore-scripts',
    ], runDir, env)
    observations = { ...observations, finalTarballsInstalled: true }

    const nativeSeed = await withProcessEnvironment(env, () => bootProfile(
      config.dshSourceDir,
      PROFILE_NAME,
      dshHome,
    ))
    let workspaceId: string
    try {
      workspaceId = String((await nativeSeed.workspaceRegistry.create(workspacePath)).id)
    } finally {
      await nativeSeed.fiber.dispose()
    }
    await writeAcceptanceOverlay(
      join(profileDir, 'cordis.patch.yml'),
      workspaceId,
      join(config.dshSourceDir, 'packages', 'test-support', 'loader-smoke', 'tests', 'fixtures', 'cli-mock-llm.ts'),
    )
    const dumped = await execFile(process.execPath, [dshBin, '--profile', PROFILE_NAME, '--dump-config'], {
      cwd: runDir,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    })
    if (!dumped.stdout.includes('id: as2-schedule')
      || !dumped.stdout.includes('id: as2-gateway')
      || !dumped.stdout.includes('id: as2-feishu')
      || !dumped.stdout.includes('dsh-control-center')
      || !dumped.stdout.includes('mode: pairing')
      || !dumped.stdout.includes(`sessionId: ${SESSION_ID}`)) {
      throw new Error('AS-2 effective DSH profile is missing an intended real-channel row')
    }
    observations = { ...observations, profileDumped: true }

    stage = 'official-transport-start'
    await writeState(statePath, stateBase, stage)
    restoreRuntimeEnvironment = installProcessEnvironment(env)
    context = await bootProfile(
      config.dshSourceDir,
      PROFILE_NAME,
      dshHome,
    )
    const gateway = requireGateway(context)
    let agent = await gateway.resolve(SEED_ROUTE_ID, new AbortController().signal)
    await eventually(() => {
      const health = gateway.healthSnapshot()
      return health.lifecycle === 'ready'
        && health.routes.liveSessions === 1
        && health.transports.ready === 1
        && health.transports.degraded === 0
    }, config.interactionTimeoutMs, 'official Feishu transport did not become ready')
    observations = { ...observations, officialTransportReady: true }

    const userMessagesBeforePairing = countUserMessages(readSessionEvents(agent.session))
    stage = 'awaiting-resident-pairing-request'
    await writeState(statePath, stateBase, stage)
    process.stderr.write(
      'AS-2 resident Gateway is ready. Send any private message to the Feishu bot; the Host will approve its pending request.\n',
    )
    let pairingRequest: ReturnType<RuntimeGateway['pendingPairings']>[number] | undefined
    await eventually(() => {
      const requests = readPendingPairings(gateway).filter(request =>
        request.adapter === 'feishu' && request.accountIdHash === preflight.appIdentityHash)
      if (requests.length > 1) {
        throw new Error('resident Gateway exposed more than one pending request for the exact Feishu App')
      }
      pairingRequest = requests[0]
      return pairingRequest !== undefined
    }, config.interactionTimeoutMs, 'resident Gateway did not expose the exact pending Feishu request')
    if (pairingRequest === undefined) throw new Error('resident Gateway pending Feishu request disappeared')
    if (countUserMessages(readSessionEvents(agent.session)) !== userMessagesBeforePairing) {
      throw new Error('the unknown pairing DM entered the native DSH Session before Host approval')
    }
    const pairingRequestId = pairingRequest.requestId
    const pairing = await gateway.approvePairingRequestForSession({
      requestId: pairingRequestId,
      workspaceId,
      sessionId: SESSION_ID,
    })
    if (readPendingPairings(gateway).some(request => request.requestId === pairingRequestId)) {
      throw new Error('resident Gateway did not atomically consume the approved pending request')
    }
    const pairedRoute = gateway.route(pairing.routeId)
    if (pairedRoute === undefined
      || pairedRoute.adapter !== 'feishu'
      || pairedRoute.accountId !== config.appId
      || pairedRoute.workspaceId !== workspaceId
      || pairedRoute.sessionId !== SESSION_ID) {
      throw new Error('resident pairing did not create the exact native DSH route')
    }
    routeIdentityHash = sha256(JSON.stringify([
      pairedRoute.accountId,
      pairedRoute.conversationId,
      pairedRoute.threadId ?? null,
      pairedRoute.userId,
    ]))
    observations = { ...observations, residentPairingGranted: true }

    stage = 'awaiting-exact-inbound'
    await writeState(statePath, stateBase, stage)
    process.stderr.write(`Pairing approved. Send this exact text as the next private message:\n${challenge}\n`)
    await eventually(() => hasExactUserText(readSessionEvents(agent.session), challenge), config.interactionTimeoutMs,
      'exact Feishu challenge was not observed in the native DSH Session')
    const hostRoute = requireFeishuHostRoute(context)
    const observedChatKind = hostRoute.observedChatKind(pairing.routeId)
    if (observedChatKind !== 'direct') {
      throw new Error(`AS-2 observed ${observedChatKind ?? 'unknown'} chat kind, expected direct`)
    }
    if (!hostRoute.routes.some(binding => binding.routeId === pairing.routeId
      && binding.workspaceId === workspaceId)) {
      throw new Error('resident paired route was not projected to the Host notice seam')
    }
    observations = { ...observations, exactInboundChallenge: true }
    let deliveredBefore = await exactDeliveredIncrement(
      gateway,
      0,
      config.interactionTimeoutMs,
      'native DSH final reply was not durably delivered to Feishu',
      pairing.routeId,
    )
    observations = { ...observations, replyDelivered: true }

    stage = 'awaiting-native-command'
    await writeState(statePath, stateBase, stage)
    process.stderr.write('Now send /feishu from the same exact Feishu user/chat.\n')
    await eventually(() => hasCommand(readSessionEvents(agent.session), 'feishu'), config.interactionTimeoutMs,
      'the /feishu Command did not enter the native DSH Session')
    deliveredBefore = await exactDeliveredIncrement(
      gateway,
      deliveredBefore,
      config.interactionTimeoutMs,
      'the /feishu Command result was not delivered',
      pairing.routeId,
    )
    observations = { ...observations, commandRoundTrip: true }

    stage = 'native-schedule-create-and-delivery'
    await writeState(statePath, stateBase, stage)
    await createNativeSchedule(config.dshSourceDir, context, agent, runId)
    await eventually(() => hasExactNativeScheduleRoundTrip(readSessionEvents(agent.session)), config.interactionTimeoutMs,
      'official DSH Schedule create/dispatch/follow-up did not complete in the native Session')
    deliveredBefore = await exactDeliveredIncrement(
      gateway,
      deliveredBefore,
      config.interactionTimeoutMs,
      'the official DSH Schedule result was not delivered to Feishu',
      pairing.routeId,
    )
    observations = { ...observations, nativeScheduleRoundTrip: true }

    stage = 'approval-dispatch-intent'
    await writeState(statePath, stateBase, stage)
    const approvalPromise = requestNativeApproval(config.dshSourceDir, context, agent)
    process.stderr.write('A real DSH Approval card was sent. Click “Allow once” in Feishu.\n')
    const approval = await withTimeout(approvalPromise, config.interactionTimeoutMs,
      'real Feishu Approval did not settle before the interaction timeout')
    if (approval !== 'allowed-once') throw new Error(`AS-2 Approval settled as ${approval}`)
    observations = { ...observations, approvalAllowedOnce: true }

    stage = 'notice-dispatch-intent'
    await writeState(statePath, stateBase, stage)
    const notice = await requireFeishuHostRoute(context).notify({
      id: sha256(`${runId}\0notice`),
      routeId: pairing.routeId,
      text: 'EvoForge AS-2 real-channel acceptance: durable host notice.',
    })
    if (!notice.created) throw new Error('AS-2 notice reused an effect before this exact run')
    deliveredBefore = await exactDeliveredIncrement(
      gateway,
      deliveredBefore,
      config.interactionTimeoutMs,
      'the durable host notice was not delivered',
      pairing.routeId,
    )
    const health = gateway.healthSnapshot(Date.now(), [pairing.routeId])
    if (countExactUserText(readSessionEvents(agent.session), challenge) !== 1) {
      throw new Error('AS-2 exact challenge was admitted more than once')
    }
    gatewayFacts = compactGateway(health)
    if (health.ingress.uncertain !== 0 || health.outbound.uncertain !== 0 || health.outbound.failed !== 0) {
      throw new Error('AS-2 observed an uncertain or failed Gateway effect')
    }
    observations = { ...observations, noticeDelivered: true }
    await context.sessions.flush(agent.session)

    stage = 'resident-host-clean-restart'
    await writeState(statePath, stateBase, stage)
    await context.fiber.dispose()
    context = undefined
    restoreRuntimeEnvironment()
    restoreRuntimeEnvironment = installProcessEnvironment(env)
    context = await bootProfile(config.dshSourceDir, PROFILE_NAME, dshHome)
    const restartedGateway = requireGateway(context)
    agent = await restartedGateway.resolve(SEED_ROUTE_ID, new AbortController().signal)
    await eventually(() => {
      const restarted = restartedGateway.healthSnapshot(Date.now(), [pairing.routeId])
      return restarted.lifecycle === 'ready'
        && restarted.routes.liveSessions === 1
        && restarted.transports.ready === 1
        && restarted.transports.degraded === 0
    }, config.interactionTimeoutMs, 'resident grant or official transport did not recover after Host restart')
    const postRestartChallenge = `${challenge}-AFTER-RESTART`
    process.stderr.write(`Host restarted without changing the grant. Send this exact private message:\n${postRestartChallenge}\n`)
    await eventually(() => hasExactUserText(readSessionEvents(agent.session), postRestartChallenge), config.interactionTimeoutMs,
      'the persisted grant did not admit a post-restart Feishu message')
    deliveredBefore = await exactDeliveredIncrement(
      restartedGateway,
      deliveredBefore,
      config.interactionTimeoutMs,
      'the post-restart native DSH reply was not delivered',
      pairing.routeId,
    )
    if (requireFeishuHostRoute(context).observedChatKind(pairing.routeId) !== 'direct') {
      throw new Error('the recovered resident route did not retain direct-message policy')
    }
    gatewayFacts = compactGateway(restartedGateway.healthSnapshot(Date.now(), [pairing.routeId]))
    observations = { ...observations, postRestartRoundTrip: true }
    await context.sessions.flush(agent.session)

    stage = 'dispose-remove-readback'
    await writeState(statePath, stateBase, stage)
    await context.fiber.dispose()
    context = undefined
    restoreRuntimeEnvironment()
    restoreRuntimeEnvironment = undefined
    await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n', { mode: 0o600 })
    await runDsh(dshBin, [
      'plugin', '--profile', PROFILE_NAME, 'remove', 'dsh-evoforge-feishu', 'dsh-evoforge-gateway', 'dsh-control-center',
    ], runDir, env)
    const removedDump = await execFile(process.execPath, [dshBin, '--profile', PROFILE_NAME, '--dump-config'], {
      cwd: runDir,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    })
    if (/name:\s+dsh-(?:gateway|feishu)\s*$/mu.test(removedDump.stdout)) {
      throw new Error('AS-2 plugin rows remained after official removal')
    }
    const native = await withProcessEnvironment(env, () => bootProfile(
      config.dshSourceDir,
      PROFILE_NAME,
      dshHome,
    ))
    try {
      const restored = await native.sessionPersistence.load(SESSION_ID)
      if (!hasExactUserText(restored.events, challenge)
        || !hasExactUserText(restored.events, `${challenge}-AFTER-RESTART`)
        || !hasCommand(restored.events, 'feishu')
        || !hasExactNativeScheduleRoundTrip(restored.events)) {
        throw new Error('native DSH Session readback lost the exact Feishu ingress, Command, or Schedule')
      }
      observations = { ...observations, sessionRecoveredAfterRemoval: true }
    } finally {
      await native.fiber.dispose()
    }
    await expectCliHostStarts(dshBin, PROFILE_NAME, runDir, env)
    observations = { ...observations, nativeHostBootedAfterRemoval: true }

    const failedGates = Object.entries(observations).filter(([, passed]) => !passed).map(([name]) => name)
    const report: AcceptanceReport = Object.freeze({
      schemaVersion: 1,
      benchmarkId: BENCHMARK_ID,
      status: failedGates.length === 0 ? 'passed' : 'failed',
      scope: manifest.scope,
      manifestHash,
      revisions: { evoforge: evoforgeRevision, deepseekHarness: dshRevision },
      chatKind: preflight.chatKind,
      appIdentityHash: preflight.appIdentityHash,
      ...(routeIdentityHash === undefined ? {} : { routeIdentityHash }),
      stage: 'complete',
      observations: Object.freeze(observations),
      ...(gatewayFacts === undefined ? {} : { gateway: Object.freeze(gatewayFacts) }),
      reasons: Object.freeze(failedGates.map(name => `hard-gate-failed:${name}`)),
    })
    await writePrivateJson(resultPath, report)
    return report
  } catch (error: unknown) {
    if (context !== undefined) await context.fiber.dispose().catch(() => {})
    restoreRuntimeEnvironment?.()
    const report: AcceptanceReport = Object.freeze({
      ...failureBase(manifest.scope, manifestHash, evoforgeRevision, dshRevision, preflight,
        boundedError(error, config)),
      stage,
      observations: Object.freeze(observations),
      ...(routeIdentityHash === undefined ? {} : { routeIdentityHash }),
      ...(gatewayFacts === undefined ? {} : { gateway: Object.freeze(gatewayFacts) }),
    })
    await writePrivateJson(resultPath, report)
    return report
  }
}

function emptyObservations(): AcceptanceReport['observations'] {
  return {
    finalTarballsInstalled: false,
    profileDumped: false,
    officialTransportReady: false,
    residentPairingGranted: false,
    exactInboundChallenge: false,
    replyDelivered: false,
    commandRoundTrip: false,
    nativeScheduleRoundTrip: false,
    approvalAllowedOnce: false,
    noticeDelivered: false,
    postRestartRoundTrip: false,
    sessionRecoveredAfterRemoval: false,
    nativeHostBootedAfterRemoval: false,
  }
}

function failureBase(
  scope: string,
  manifestHash: string,
  evoforgeRevision: string,
  dshRevision: string,
  preflight: ReadyReport,
  reason: string,
): AcceptanceReport {
  return Object.freeze({
    schemaVersion: 1,
    benchmarkId: BENCHMARK_ID,
    status: 'failed',
    scope,
    manifestHash,
    revisions: { evoforge: evoforgeRevision, deepseekHarness: dshRevision },
    chatKind: preflight.chatKind,
    appIdentityHash: preflight.appIdentityHash,
    stage: 'preflight',
    observations: Object.freeze(emptyObservations()),
    reasons: Object.freeze([reason]),
  })
}

async function acceptanceEnvironment(
  config: RealFeishuExecutionConfig,
  dshHome: string,
  runDir: string,
): Promise<NodeJS.ProcessEnv> {
  const storePath = (await execFile('pnpm', ['store', 'path'], {
    cwd: suiteRoot,
    encoding: 'utf8',
    timeout: 10_000,
  })).stdout.trim()
  const corepackHome = process.env.COREPACK_HOME
    ?? (process.env.HOME === undefined
      ? undefined
      : join(process.env.HOME, 'Library', 'Caches', 'node', 'corepack'))
  return {
    ...process.env,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    COREPACK_DEFAULT_TO_LATEST: '0',
    ...(corepackHome === undefined ? {} : { COREPACK_HOME: corepackHome }),
    DSH_HOME: dshHome,
    DSH_AGENTS_HOME: join(runDir, '.agents-home'),
    DSH_PERMISSION_MODE: 'danger-full-access',
    DSH_TELEMETRY_DISABLED: '1',
    DSH_FEISHU_APP_ID: config.appId,
    DSH_FEISHU_APP_SECRET: config.appSecret,
    HOME: runDir,
    npm_config_ignore_scripts: 'true',
    npm_config_store_dir: storePath,
  }
}

async function packFinalBundles(runDir: string): Promise<{ control: string; gateway: string; feishu: string }> {
  const packRoot = await exactDirectory(join(runDir, 'packs'))
  for (const packageName of ['dsh-control-center', 'dsh-evoforge-gateway', 'dsh-evoforge-feishu']) {
    await execFile('pnpm', ['--filter', packageName, 'pack', '--pack-destination', packRoot], {
      cwd: suiteRoot,
      encoding: 'utf8',
      timeout: 60_000,
    })
  }
  const files = await readdir(packRoot)
  const control = files.find(file => /^dsh-control-center-.*\.tgz$/u.test(file))
  const gateway = files.find(file => /^dsh-evoforge-gateway-.*\.tgz$/u.test(file))
  const feishu = files.find(file => /^dsh-evoforge-feishu-.*\.tgz$/u.test(file))
  if (control === undefined || gateway === undefined || feishu === undefined) {
    throw new Error('AS-2 final tarballs were not produced')
  }
  return { control: join(packRoot, control), gateway: join(packRoot, gateway), feishu: join(packRoot, feishu) }
}

async function assertPackedBoundary(tarballs: { control: string; gateway: string; feishu: string }): Promise<void> {
  for (const tarball of [tarballs.control, tarballs.gateway, tarballs.feishu]) {
    const list = (await execFile('tar', ['-tf', tarball], { encoding: 'utf8', timeout: 10_000 })).stdout
    if (/(^|\/)node_modules\//u.test(list) || /(^|\/)cli\.(?:mjs|js)$/mu.test(list)) {
      throw new Error('AS-2 packed Bundle contains a forbidden Runtime or product CLI')
    }
  }
}

async function writeAcceptanceOverlay(
  path: string,
  workspaceId: string,
  mockLlmPath: string,
): Promise<void> {
  const overlay = `# AS-2 is a non-interactive Host acceptance runner. Keep DSH's native Web
# server available for RPC composition, but do not print a fresh URL (or hand
# off a browser) for every seed/restart boot; the product control surface
# remains one native conversation.view page when a user runs DSH.
# This is a row replacement, not an insert: dsh-web-app already owns the
# web-runtime row and this profile layer replaces it by id.
- id: web-runtime
  config:
    openBrowser: false
    printUrl: false
    surfaceContext: false
    trustedHosts: []

- insert:
    - id: as2-cli-mock-llm
      name: ${yaml(mockLlmPath)}

    # Schedule observes only roots created after it loads. This benchmark-only
    # seed route creates the native Session that Host pairing may approve; it
    # does not authorize any Feishu endpoint.
    - id: as2-schedule
      name: '@deepseek-ai/dsh-schedule'

    - id: as2-gateway
      name: dsh-evoforge-gateway
      config:
        routes:
          - id: ${SEED_ROUTE_ID}
            adapter: as2-seed
            accountId: local-acceptance
            conversationId: native-session
            userId: native-host
            workspaceId: ${yaml(workspaceId)}
            sessionId: ${SESSION_ID}
            agentPreset: standard
            provider: cli-mock
            model: cli-mock

    - id: as2-feishu
      name: dsh-evoforge-feishu
      config:
        mode: pairing
        routeIds: []
        appIdEnv: DSH_FEISHU_APP_ID
        appSecretEnv: DSH_FEISHU_APP_SECRET
        contentPermissions: []
`
  await writeFile(path, overlay, { mode: 0o600 })
  await chmod(path, 0o600)
}

async function bootProfile(
  dshSourceDir: string,
  profileName: string,
  dshHome: string,
): Promise<RuntimeContext> {
  const appBoot = await import(pathToFileURL(
    join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
  ).href) as any
  const { provideCmdline } = await import(pathToFileURL(
    join(dshSourceDir, 'packages', 'boot', 'cmdline', 'lib', 'index.js'),
  ).href) as any
  const installAnchor = join(dshSourceDir, 'apps', 'cli', 'package.json')
  const profile = appBoot.loadProfile('evoforge-feishu-as2', profileName, installAnchor, dshHome)
  // DSH alpha.5 exposes the healer as an options object and needs the loaded
  // profile to link Bundle-only dependencies into this profile's fallback.
  await appBoot.healProfilesModuleFallback({ installAnchor, profile, home: dshHome })
  const rootConfig = join(profile.dir, 'cordis.yml')
  await writeFile(rootConfig, '[]\n', { mode: 0o600 })
  const shippedPresetPatch = {
    id: 'agent-presets',
    config: {
      default: 'standard',
      roots: [{
        path: join(dshSourceDir, 'apps', 'cli', 'config', 'agent-presets'),
        trust: 'system',
      }],
      includeUserRoot: false,
    },
  }
  return await appBoot.boot(
    'evoforge-feishu-as2',
    rootConfig,
    [
      ...profile.layers.flatMap((layer: { readonly patches: readonly unknown[] }) => layer.patches),
      ...profile.patches,
      shippedPresetPatch,
    ],
    (hostCtx: { provide(...args: unknown[]): unknown }) => provideCmdline(hostCtx, {
      args: ['--port', '0', '--no-open'],
      exit: () => {},
    }),
  ) as RuntimeContext
}

async function requestNativeApproval(
  dshSourceDir: string,
  context: RuntimeContext,
  agent: RuntimeAgent,
): Promise<ApprovalOutcome> {
  const agentModule = await import(pathToFileURL(
    join(dshSourceDir, 'packages', 'core', 'agent', 'lib', 'index.js'),
  ).href) as {
    agentEvents(ctx: unknown, agent: unknown): {
      waterfall(
        event: 'approval/request',
        request: { readonly toolName: string; readonly reason: string; readonly signal: AbortSignal },
        fallback: () => Promise<ApprovalOutcome>,
      ): Promise<ApprovalOutcome>
    }
  }
  return await agentModule.agentEvents(context, agent).waterfall('approval/request', {
    toolName: 'as2-real-feishu-protected-action',
    reason: 'Verify one exact real Feishu Approval card and once-only human decision.',
    signal: new AbortController().signal,
  }, () => Promise.resolve<ApprovalOutcome>('unavailable'))
}

async function createNativeSchedule(
  dshSourceDir: string,
  context: RuntimeContext,
  agent: RuntimeAgent,
  runId: string,
): Promise<void> {
  if (context.tools.get('schedule_create', agent) === undefined) {
    throw new Error('AS-2 official Schedule Tool was not registered before the Gateway Agent')
  }
  const llmModule = await import(pathToFileURL(
    join(dshSourceDir, 'packages', 'llm', 'llm', 'lib', 'index.js'),
  ).href) as { CallId(id: string): string }
  const scheduled = await context.agents.withInitiator(agent, () => context.tools.execute({
    signal: new AbortController().signal,
    callId: llmModule.CallId(`as2-schedule-${runId.slice(0, 16)}`),
    name: 'schedule_create',
    arguments: {
      prompt: `EvoForge AS-2 native Schedule round trip ${runId.slice(0, 16)}.`,
      after_seconds: 1,
    },
    agent,
  }))
  if (scheduled.isError === true) throw new Error('AS-2 official schedule_create returned an error')
  await context.sessions.flush(agent.session)
}

function requireGateway(context: RuntimeContext): RuntimeGateway {
  const gateway = context.get('evoforge.gateway') as RuntimeGateway | undefined
  if (gateway === undefined) throw new Error('AS-2 production dsh-gateway did not load')
  return gateway
}

function readPendingPairings(gateway: RuntimeGateway): ReturnType<RuntimeGateway['pendingPairings']> {
  const pending = gateway.pendingPairings()
  if (Array.isArray(pending)) return pending
  const prototype = Object.getPrototypeOf(gateway) as object | null
  const methods = prototype === null
    ? []
    : Object.getOwnPropertyNames(prototype).filter(name => name !== 'constructor').slice(0, 32)
  throw new Error(
    `DSH gateway pending pairing API returned ${pending === null ? 'null' : typeof pending}; methods=${methods.join(',')}`,
  )
}

function requireFeishuHostRoute(context: RuntimeContext): FeishuHostRoute {
  const route = context.get('evoforge.feishuRoute') as FeishuHostRoute | undefined
  if (route === undefined) throw new Error('AS-2 production dsh-feishu host route did not load')
  return route
}

function hasExactUserText(events: readonly RuntimeEvent[], expected: string): boolean {
  return countExactUserText(events, expected) > 0
}

/** Read the immutable Session snapshot across the current DSH and rc APIs. */
function readSessionEvents(session: RuntimeAgent['session']): readonly RuntimeEvent[] {
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  if (session.events !== undefined) return session.events
  throw new Error('DSH Session does not expose a readable event snapshot')
}

function countUserMessages(events: readonly RuntimeEvent[]): number {
  return events.filter(event => event.type === 'user/message').length
}

function countExactUserText(events: readonly RuntimeEvent[], expected: string): number {
  return events.filter((event) => {
    if (event.type !== 'user/message' || typeof event.data !== 'object' || event.data === null) return false
    const content = (event.data as { readonly content?: unknown }).content
    return Array.isArray(content) && content.some(block => typeof block === 'object' && block !== null
      && (block as { readonly type?: unknown }).type === 'text'
      && (block as { readonly text?: unknown }).text === expected)
  }).length
}

function hasCommand(events: readonly RuntimeEvent[], name: string): boolean {
  return events.some(event => event.type === 'command/run' && typeof event.data === 'object'
    && event.data !== null && (event.data as { readonly name?: unknown }).name === name)
}

function compactGateway(health: GatewayHealthSnapshot): NonNullable<AcceptanceReport['gateway']> {
  return {
    ingressSettled: health.ingress.settled,
    ingressUncertain: health.ingress.uncertain,
    outboundDelivered: health.outbound.delivered,
    outboundUncertain: health.outbound.uncertain,
    outboundFailed: health.outbound.failed,
  }
}

async function eventually(
  predicate: () => boolean,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  if (predicate()) return
  throw new Error(message)
}

async function exactDeliveredIncrement(
  gateway: RuntimeGateway,
  before: number,
  timeoutMs: number,
  message: string,
  routeId: string,
): Promise<number> {
  await eventually(
    () => gateway.healthSnapshot(Date.now(), [routeId]).outbound.delivered >= before + 1,
    timeoutMs,
    message,
  )
  const delivered = gateway.healthSnapshot(Date.now(), [routeId]).outbound.delivered
  if (delivered !== before + 1) {
    throw new Error(`AS-2 expected exactly one new delivered effect, observed ${String(delivered - before)}`)
  }
  return delivered
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function runDsh(
  dshBin: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    await execFile(process.execPath, [dshBin, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 120_000,
    })
  } catch (error: unknown) {
    const failure = error as { readonly stdout?: string; readonly stderr?: string }
    throw new Error(`AS-2 DSH command failed: ${boundedOutput(failure.stdout)} ${boundedOutput(failure.stderr)}`)
  }
}

async function expectCliHostStarts(
  dshBin: string,
  profile: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const child = spawn(process.execPath, [dshBin, '--profile', profile, '--port', '0', '--no-open'], {
    cwd,
    env,
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  const exited = new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>(resolveExit => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  const early = await Promise.race([
    exited.then(result => ({ kind: 'exit' as const, result })),
    new Promise<{ readonly kind: 'running' }>(resolveWait => {
      setTimeout(() => resolveWait({ kind: 'running' }), 1_500)
    }),
  ])
  if (early.kind === 'exit') throw new Error(`native DSH Host exited before readiness: ${JSON.stringify(early.result)}`)
  child.kill('SIGTERM')
  const result = await exited
  if (result.code !== 0 || result.signal !== null) {
    throw new Error(`native DSH Host did not stop cleanly: ${JSON.stringify(result)}`)
  }
}

async function withProcessEnvironment<T>(
  environment: NodeJS.ProcessEnv,
  operation: () => Promise<T>,
): Promise<T> {
  const restore = installProcessEnvironment(environment)
  try {
    return await operation()
  } finally {
    restore()
  }
}

function installProcessEnvironment(environment: NodeJS.ProcessEnv): () => void {
  const names = [
    'DSH_HOME',
    'DSH_AGENTS_HOME',
    'DSH_PERMISSION_MODE',
    'DSH_TELEMETRY_DISABLED',
    'DSH_FEISHU_APP_ID',
    'DSH_FEISHU_APP_SECRET',
  ] as const
  const prior = new Map(names.map(name => [name, process.env[name]]))
  for (const name of names) {
    const value = environment[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  return () => {
    for (const name of names) {
      const value = prior.get(name)
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

async function exactDirectory(path: string): Promise<string> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const canonical = await realpath(path)
  if (canonical !== resolve(path)) {
    throw new Error('AS-2 run directories must not traverse symlinks; on macOS use /private/tmp instead of /tmp')
  }
  await chmod(canonical, 0o700)
  return canonical
}

async function assertDshBuild(dshSourceDir: string): Promise<void> {
  for (const path of [
    join(dshSourceDir, 'apps', 'cli', 'lib', 'bin.js'),
    join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
    join(dshSourceDir, 'packages', 'core', 'agent', 'lib', 'index.js'),
  ]) await access(path)
}

async function writeState(
  path: string,
  base: Omit<AcceptanceState, 'stage' | 'updatedAt'>,
  stage: string,
): Promise<void> {
  await writePrivateJson(path, { ...base, stage, updatedAt: new Date().toISOString() })
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function boundedError(error: unknown, config: RealFeishuExecutionConfig): string {
  let value = error instanceof Error ? error.message : String(error)
  for (const privateValue of [config.appId, config.appSecret]) {
    value = value.replaceAll(privateValue, '[redacted]')
  }
  return value.replace(/[\r\n]+/gu, ' ').slice(0, 512) || 'unknown AS-2 failure'
}

function boundedOutput(value: string | undefined): string {
  return (value ?? '').replace(/[\r\n]+/gu, ' ').slice(0, 256)
}

function yaml(value: string): string {
  return JSON.stringify(value)
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd, encoding: 'utf8' })).stdout.trim()
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
