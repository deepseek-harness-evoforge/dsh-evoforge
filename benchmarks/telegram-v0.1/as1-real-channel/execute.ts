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
  assertRealTelegramTerminalReport,
  BENCHMARK_ID,
  emptyTelegramObservations,
  type RealTelegramAcceptanceResolution,
  type RealTelegramExecutionConfig,
  type RealTelegramTerminalReport,
} from './contract.ts'

const execFile = promisify(execFileCallback)
const benchmarkRoot = dirname(fileURLToPath(import.meta.url))
const suiteRoot = resolve(benchmarkRoot, '../../..')
const PROFILE_NAME = 'web'
const SESSION_ID = 'evoforge-telegram-as1-real'
const SEED_ROUTE_ID = 'as1-native-session-seed'

type ReadyReport = Extract<RealTelegramAcceptanceResolution, { status: 'ready' }>['report']
type AcceptanceReport = RealTelegramTerminalReport
type ApprovalOutcome = 'allowed-once' | 'allowed-always' | 'denied' | 'unavailable' | 'cancelled'

interface GatewayHealthSnapshot {
  readonly lifecycle: 'starting' | 'ready' | 'stopping'
  readonly routes: { readonly liveSessions: number }
  readonly ingress: { readonly settled: number; readonly uncertain: number }
  readonly transports: { readonly ready: number; readonly degraded: number }
  readonly outbound: { readonly delivered: number; readonly uncertain: number; readonly failed: number }
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
  dispatch(input: {
    readonly endpoint: { readonly adapter: string; readonly accountId: string; readonly conversationId: string; readonly userId: string }
    readonly eventId: string
    readonly text: string
  }): Promise<{ readonly duplicate: boolean; readonly kind: string }>
}

interface RuntimeAgent {
  readonly session: {
    readonly snapshotEvents?: () => readonly RuntimeEvent[]
    readonly events?: readonly RuntimeEvent[]
  }
  whenIdle(): Promise<void>
}

interface RuntimeEvent { readonly type: string; readonly data?: unknown }

interface RuntimeContext {
  readonly fiber: { dispose(): Promise<void> }
  readonly agents: { withInitiator<T>(agent: RuntimeAgent, operation: () => Promise<T>): Promise<T> }
  readonly sessions: { flush(session: unknown): Promise<void> }
  readonly sessionPersistence: { load(id: unknown): Promise<{ events: readonly RuntimeEvent[] }> }
  readonly tools: {
    get(name: string, agent: RuntimeAgent): unknown
  }
  readonly workspaceRegistry: { create(path: string): Promise<{ readonly id: unknown }> }
  get(name: string): unknown
}

interface AcceptanceState {
  readonly schemaVersion: 1
  readonly benchmarkId: typeof BENCHMARK_ID
  readonly manifestHash: string
  readonly revisions: {
    readonly evoforge: string
    readonly deepseekHarness: string
    readonly auditedLatestDeepseekHarness: string
  }
  readonly accountIdentityHash: string
  readonly chatKind: 'direct'
  readonly challenge: string
  readonly stage: string
  readonly updatedAt: string
}

/**
 * Run the real Telegram private-chat epoch through final packed Bundles.
 * Human actions are deliberately requested on stderr; no stdin pairing code
 * is accepted and no platform fake is substituted for the official Bot API.
 */
export async function executeRealTelegramAcceptance(
  config: RealTelegramExecutionConfig,
  preflight: ReadyReport,
): Promise<AcceptanceReport> {
  const manifestSource = await readFile(join(benchmarkRoot, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(manifestSource) as {
    readonly id: string
    readonly scope: string
    readonly revisions: {
      readonly deepseekHarness: string
      readonly auditedLatestDeepseekHarness: string
    }
  }
  if (manifest.id !== BENCHMARK_ID
    || !/^[a-f0-9]{40}$/u.test(manifest.revisions.deepseekHarness)
    || !/^[a-f0-9]{40}$/u.test(manifest.revisions.auditedLatestDeepseekHarness)) {
    throw new Error('AS-1 manifest identity is invalid')
  }
  const manifestHash = sha256(manifestSource)
  const [evoforgeRevision, dshRevision, evoforgeDirty, dshDirty] = await Promise.all([
    git(suiteRoot, 'rev-parse', 'HEAD'),
    git(config.dshSourceDir, 'rev-parse', 'HEAD'),
    git(suiteRoot, 'status', '--porcelain'),
    git(config.dshSourceDir, 'status', '--porcelain'),
  ])
  if (evoforgeDirty !== '') throw new Error('AS-1 requires a clean EvoForge revision before real effects')
  if (dshDirty !== '') throw new Error('AS-1 requires a clean DSH checkout before real effects')
  if (dshRevision !== manifest.revisions.deepseekHarness) {
    throw new Error(`AS-1 DSH revision mismatch: expected ${manifest.revisions.deepseekHarness}, got ${dshRevision}`)
  }
  await assertDshBuild(config.dshSourceDir)

  const root = await exactDirectory(config.runRoot)
  const runId = sha256(JSON.stringify([
    BENCHMARK_ID,
    manifestHash,
    evoforgeRevision,
    dshRevision,
    manifest.revisions.auditedLatestDeepseekHarness,
    preflight.accountIdentityHash,
  ]))
  const runDir = await exactDirectory(join(root, BENCHMARK_ID, runId))
  const resultPath = join(runDir, 'result.json')
  const statePath = join(runDir, 'state.json')
  const previous = await readJson<unknown>(resultPath)
  if (previous !== undefined) {
    assertRealTelegramTerminalReport(previous, {
      manifestHash,
      evoforgeRevision,
      dshRevision,
      auditedLatestDshRevision: manifest.revisions.auditedLatestDeepseekHarness,
      preflight,
    })
    return previous
  }
  if (await exists(statePath)) {
    throw new Error('prior-nonterminal-real-effects-require-a-new-run-root-after-manual-audit')
  }

  const challenge = `EVOFORGE-AS1-${runId.slice(0, 16)}`
  const stateBase: Omit<AcceptanceState, 'stage' | 'updatedAt'> = {
    schemaVersion: 1,
    benchmarkId: BENCHMARK_ID,
    manifestHash,
    revisions: {
      evoforge: evoforgeRevision,
      deepseekHarness: dshRevision,
      auditedLatestDeepseekHarness: manifest.revisions.auditedLatestDeepseekHarness,
    },
    accountIdentityHash: preflight.accountIdentityHash,
    chatKind: preflight.chatKind,
    challenge,
  }
  let stage = 'prepared'
  let context: RuntimeContext | undefined
  let restoreEnvironment: (() => void) | undefined
  let observations = emptyTelegramObservations()
  let gatewayFacts: AcceptanceReport['gateway']
  let routeIdentityHash: string | undefined
  await writeState(statePath, stateBase, stage)

  try {
    const dshHome = join(runDir, 'dsh-home')
    const profileDir = join(dshHome, 'profiles', PROFILE_NAME)
    const workspacePath = await exactDirectory(join(runDir, 'workspace'))
    const environment = await acceptanceEnvironment(config, dshHome, runDir)
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
      tarballs.telegram,
      '--prefer-offline', '--ignore-scripts',
    ], runDir, environment)
    observations = { ...observations, finalTarballsInstalled: true }

    const seed = await withProcessEnvironment(environment, () => bootProfile(
      config.dshSourceDir,
      PROFILE_NAME,
      dshHome,
    ))
    let workspaceId: string
    try {
      workspaceId = String((await seed.workspaceRegistry.create(workspacePath)).id)
    } finally {
      await seed.fiber.dispose()
    }
    await writeAcceptanceOverlay(
      join(profileDir, 'cordis.patch.yml'),
      workspaceId,
      join(config.dshSourceDir, 'packages', 'test-support', 'loader-smoke', 'tests', 'fixtures', 'cli-mock-llm.ts'),
      config.accountId,
    )
    const dumped = await execFile(process.execPath, [dshBin, '--profile', PROFILE_NAME, '--dump-config'], {
      cwd: runDir,
      env: environment,
      encoding: 'utf8',
      timeout: 30_000,
    })
    if (!dumped.stdout.includes('id: as1-gateway')
      || !dumped.stdout.includes('id: as1-telegram')
      || !dumped.stdout.includes('dsh-control-center')
      || !dumped.stdout.includes('mode: pairing')
      || !dumped.stdout.includes(`sessionId: ${SESSION_ID}`)) {
      throw new Error('AS-1 effective DSH profile is missing the intended Telegram rows')
    }
    observations = { ...observations, profileDumped: true }

    stage = 'official-transport-start'
    await writeState(statePath, stateBase, stage)
    restoreEnvironment = installProcessEnvironment(environment)
    context = await bootProfile(config.dshSourceDir, PROFILE_NAME, dshHome)
    const gateway = requireGateway(context)
    let agent = await gateway.resolve(SEED_ROUTE_ID, new AbortController().signal)
    await eventually(() => {
      const health = gateway.healthSnapshot()
      return health.lifecycle === 'ready'
        && health.routes.liveSessions === 1
        && health.transports.ready === 1
        && health.transports.degraded === 0
    }, config.interactionTimeoutMs, 'official Telegram transport did not become ready')
    observations = { ...observations, officialTransportReady: true }

    const messagesBeforePairing = countUserMessages(readSessionEvents(agent.session))
    stage = 'awaiting-resident-pairing-request'
    await writeState(statePath, stateBase, stage)
    process.stderr.write(
      'AS-1 resident Gateway is ready. Send any private message to the Telegram Bot; the Host will approve its pending request.\n',
    )
    let pending: ReturnType<RuntimeGateway['pendingPairings']>[number] | undefined
    const accountHash = sha256(config.accountId)
    await eventually(() => {
      const requests = gateway.pendingPairings().filter(request =>
        request.adapter === 'telegram' && request.accountIdHash === accountHash)
      if (requests.length > 1) throw new Error('AS-1 exposed more than one pending request for this Bot account')
      pending = requests[0]
      return pending !== undefined
    }, config.interactionTimeoutMs, 'resident Gateway did not expose the Telegram pending request')
    if (pending === undefined) throw new Error('resident Gateway pending Telegram request disappeared')
    if (countUserMessages(readSessionEvents(agent.session)) !== messagesBeforePairing) {
      throw new Error('the unknown Telegram DM entered the native DSH Session before Host approval')
    }
    observations = { ...observations, pairingCodeDelivered: true, unknownMessageNotDispatched: true }

    const pairing = await gateway.approvePairingRequestForSession({
      requestId: pending.requestId,
      workspaceId: String((gateway.route(SEED_ROUTE_ID) ?? {}).workspaceId ?? ''),
      sessionId: SESSION_ID,
    })
    if (gateway.pendingPairings().some(request => request.requestId === pending!.requestId)) {
      throw new Error('resident Gateway did not atomically consume the approved Telegram request')
    }
    const pairedRoute = gateway.route(pairing.routeId)
    if (pairedRoute === undefined
      || pairedRoute.adapter !== 'telegram'
      || pairedRoute.accountId !== config.accountId
      || pairedRoute.workspaceId !== String((gateway.route(SEED_ROUTE_ID) ?? {}).workspaceId ?? '')
      || pairedRoute.sessionId !== SESSION_ID) {
      throw new Error('resident Telegram pairing did not create the exact native DSH route')
    }
    routeIdentityHash = sha256(JSON.stringify([
      pairedRoute.accountId,
      pairedRoute.conversationId,
      pairedRoute.threadId ?? null,
      pairedRoute.userId,
    ]))
    observations = { ...observations, hostPairingApproved: true }

    stage = 'awaiting-exact-inbound'
    await writeState(statePath, stateBase, stage)
    process.stderr.write(`Pairing approved. Send this exact private message to the Bot:\n${challenge}\n`)
    await eventually(() => hasExactUserText(readSessionEvents(agent.session), challenge), config.interactionTimeoutMs,
      'exact Telegram challenge was not observed in the native DSH Session')
    if (countExactUserText(readSessionEvents(agent.session), challenge) !== 1) {
      throw new Error('AS-1 exact challenge was admitted more than once')
    }
    observations = { ...observations, exactChallengeDelivered: true }
    let deliveredBefore = await exactDeliveredIncrement(
      gateway,
      0,
      config.interactionTimeoutMs,
      'native DSH final Telegram reply was not durably delivered',
      pairing.routeId,
    )
    observations = { ...observations, replyDelivered: true }

    stage = 'gateway-ingress-replay'
    await writeState(statePath, stateBase, stage)
    const endpoint = {
      adapter: pairedRoute.adapter,
      accountId: pairedRoute.accountId,
      conversationId: pairedRoute.conversationId,
      userId: pairedRoute.userId,
    }
    const replayEventId = `host-replay:${runId.slice(0, 24)}`
    const firstReplay = await gateway.dispatch({ endpoint, eventId: replayEventId, text: '/telegram' })
    const secondReplay = await gateway.dispatch({ endpoint, eventId: replayEventId, text: '/telegram' })
    if (firstReplay.duplicate || !secondReplay.duplicate) {
      throw new Error('Gateway replay did not suppress the second ingress identity')
    }
    observations = { ...observations, duplicateIngressSuppressed: true }

    stage = 'native-approval'
    await writeState(statePath, stateBase, stage)
    const approvalPromise = requestNativeApproval(config.dshSourceDir, context, agent)
    process.stderr.write('A native DSH Approval card was sent to Telegram. Click “Allow once”.\n')
    const approval = await withTimeout(approvalPromise, config.interactionTimeoutMs,
      'Telegram Approval did not settle before the interaction timeout')
    if (approval !== 'allowed-once') throw new Error(`AS-1 Approval settled as ${approval}`)
    observations = { ...observations, approvalAllowedOnce: true }
    gatewayFacts = compactGateway(gateway.healthSnapshot(Date.now(), [pairing.routeId]))
    if (gatewayFacts.ingressUncertain !== 0 || gatewayFacts.outboundUncertain !== 0 || gatewayFacts.outboundFailed !== 0) {
      throw new Error('AS-1 observed an uncertain or failed Gateway effect')
    }
    await context.sessions.flush(agent.session)

    stage = 'resident-host-clean-restart'
    await writeState(statePath, stateBase, stage)
    await context.fiber.dispose()
    context = undefined
    restoreEnvironment()
    restoreEnvironment = installProcessEnvironment(environment)
    context = await bootProfile(config.dshSourceDir, PROFILE_NAME, dshHome)
    const restartedGateway = requireGateway(context)
    const recoveredRoute = restartedGateway.route(pairing.routeId)
    if (recoveredRoute === undefined) throw new Error('persisted Telegram grant disappeared after Host restart')
    agent = await restartedGateway.resolve(pairing.routeId, new AbortController().signal)
    await eventually(() => {
      const health = restartedGateway.healthSnapshot(Date.now(), [pairing.routeId])
      return health.lifecycle === 'ready'
        && health.routes.liveSessions === 1
        && health.transports.ready === 1
        && health.transports.degraded === 0
    }, config.interactionTimeoutMs, 'Telegram grant or transport did not recover after Host restart')
    const postRestartChallenge = `${challenge}-AFTER-RESTART`
    process.stderr.write(`Host restarted without changing the grant. Send this exact private message:\n${postRestartChallenge}\n`)
    await eventually(() => hasExactUserText(readSessionEvents(agent.session), postRestartChallenge), config.interactionTimeoutMs,
      'persisted grant did not admit a post-restart Telegram message')
    deliveredBefore = await exactDeliveredIncrement(
      restartedGateway,
      deliveredBefore,
      config.interactionTimeoutMs,
      'post-restart native Telegram reply was not durably delivered',
      pairing.routeId,
    )
    observations = { ...observations, postRestartRoundTrip: true }
    gatewayFacts = compactGateway(restartedGateway.healthSnapshot(Date.now(), [pairing.routeId]))
    await context.sessions.flush(agent.session)

    stage = 'dispose-remove-readback'
    await writeState(statePath, stateBase, stage)
    await context.fiber.dispose()
    context = undefined
    restoreEnvironment()
    restoreEnvironment = undefined
    await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n', { mode: 0o600 })
    await runDsh(dshBin, [
      'plugin', '--profile', PROFILE_NAME, 'remove', 'dsh-telegram', 'dsh-gateway', 'dsh-control-center',
    ], runDir, environment)
    const removedDump = await execFile(process.execPath, [dshBin, '--profile', PROFILE_NAME, '--dump-config'], {
      cwd: runDir,
      env: environment,
      encoding: 'utf8',
      timeout: 30_000,
    })
    if (/name:\s+dsh-(?:gateway|telegram|control-center)\s*$/mu.test(removedDump.stdout)) {
      throw new Error('AS-1 plugin rows remained after official removal')
    }
    const native = await withProcessEnvironment(environment, () => bootProfile(
      config.dshSourceDir,
      PROFILE_NAME,
      dshHome,
    ))
    try {
      const restored = await native.sessionPersistence.load(SESSION_ID)
      if (!hasExactUserText(restored.events, challenge)
        || !hasExactUserText(restored.events, `${challenge}-AFTER-RESTART`)) {
        throw new Error('native DSH Session readback lost exact Telegram ingress facts')
      }
      observations = { ...observations, sessionRecoveredAfterRemoval: true }
    } finally {
      await native.fiber.dispose()
    }
    await expectCliHostStarts(dshBin, PROFILE_NAME, runDir, environment)
    observations = { ...observations, nativeHostBootedAfterRemoval: true }

    const failedGates = Object.entries(observations).filter(([, passed]) => !passed).map(([name]) => name)
    const report: AcceptanceReport = Object.freeze({
      schemaVersion: 1,
      benchmarkId: BENCHMARK_ID,
      status: failedGates.length === 0 ? 'passed' : 'failed',
      scope: manifest.scope,
      manifestHash,
      revisions: {
        evoforge: evoforgeRevision,
        deepseekHarness: dshRevision,
        auditedLatestDeepseekHarness: manifest.revisions.auditedLatestDeepseekHarness,
      },
      chatKind: preflight.chatKind,
      accountIdentityHash: preflight.accountIdentityHash,
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
    restoreEnvironment?.()
    const report: AcceptanceReport = Object.freeze({
      schemaVersion: 1,
      benchmarkId: BENCHMARK_ID,
      status: 'failed',
      scope: manifest.scope,
      manifestHash,
      revisions: {
        evoforge: evoforgeRevision,
        deepseekHarness: dshRevision,
        auditedLatestDeepseekHarness: manifest.revisions.auditedLatestDeepseekHarness,
      },
      chatKind: preflight.chatKind,
      accountIdentityHash: preflight.accountIdentityHash,
      ...(routeIdentityHash === undefined ? {} : { routeIdentityHash }),
      stage,
      observations: Object.freeze(observations),
      ...(gatewayFacts === undefined ? {} : { gateway: Object.freeze(gatewayFacts) }),
      reasons: Object.freeze([boundedError(error, config)]),
    })
    await writePrivateJson(resultPath, report)
    return report
  }
}

async function acceptanceEnvironment(
  config: RealTelegramExecutionConfig,
  dshHome: string,
  runDir: string,
): Promise<NodeJS.ProcessEnv> {
  const storePath = (await execFile('pnpm', ['store', 'path'], {
    cwd: suiteRoot,
    encoding: 'utf8',
    timeout: 10_000,
  })).stdout.trim()
  const corepackHome = process.env.COREPACK_HOME
    ?? (process.env.HOME === undefined ? undefined : join(process.env.HOME, 'Library', 'Caches', 'node', 'corepack'))
  return {
    ...process.env,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    COREPACK_DEFAULT_TO_LATEST: '0',
    ...(corepackHome === undefined ? {} : { COREPACK_HOME: corepackHome }),
    DSH_HOME: dshHome,
    DSH_AGENTS_HOME: join(runDir, '.agents-home'),
    DSH_PERMISSION_MODE: 'danger-full-access',
    DSH_TELEMETRY_DISABLED: '1',
    DSH_TELEGRAM_BOT_TOKEN: config.botToken,
    HOME: runDir,
    npm_config_ignore_scripts: 'true',
    npm_config_store_dir: storePath,
  }
}

async function packFinalBundles(runDir: string): Promise<{ control: string; gateway: string; telegram: string }> {
  const packRoot = await exactDirectory(join(runDir, 'packs'))
  for (const packageName of ['dsh-control-center', 'dsh-gateway', 'dsh-telegram']) {
    await execFile('pnpm', ['--filter', packageName, 'pack', '--pack-destination', packRoot], {
      cwd: suiteRoot,
      encoding: 'utf8',
      timeout: 60_000,
    })
  }
  const files = await readdir(packRoot)
  const control = files.find(file => /^dsh-control-center-.*\.tgz$/u.test(file))
  const gateway = files.find(file => /^dsh-gateway-.*\.tgz$/u.test(file))
  const telegram = files.find(file => /^dsh-telegram-.*\.tgz$/u.test(file))
  if (control === undefined || gateway === undefined || telegram === undefined) {
    throw new Error('AS-1 final tarballs were not produced')
  }
  return { control: join(packRoot, control), gateway: join(packRoot, gateway), telegram: join(packRoot, telegram) }
}

async function assertPackedBoundary(tarballs: { control: string; gateway: string; telegram: string }): Promise<void> {
  for (const tarball of [tarballs.control, tarballs.gateway, tarballs.telegram]) {
    const list = (await execFile('tar', ['-tf', tarball], { encoding: 'utf8', timeout: 10_000 })).stdout
    if (/(^|\/)node_modules\//u.test(list) || /(^|\/)cli\.(?:mjs|js)$/mu.test(list)) {
      throw new Error('AS-1 packed Bundle contains a forbidden Runtime or product CLI')
    }
  }
}

async function writeAcceptanceOverlay(
  path: string,
  workspaceId: string,
  mockLlmPath: string,
  accountId: string,
): Promise<void> {
  const overlay = `# AS-1 is a non-interactive Host acceptance runner. DSH's native Web runtime remains available
# for RPC composition, but no extra browser URL or page is opened by this runner.
- id: web-runtime
  config:
    openBrowser: false
    printUrl: false
    surfaceContext: false
    trustedHosts: []

- insert:
    - id: as1-cli-mock-llm
      name: ${yaml(mockLlmPath)}

    - id: as1-gateway
      name: dsh-gateway
      config:
        routes:
          - id: ${SEED_ROUTE_ID}
            adapter: as1-seed
            accountId: local-acceptance
            conversationId: native-session
            userId: native-host
            workspaceId: ${yaml(workspaceId)}
            sessionId: ${SESSION_ID}
            agentPreset: standard
            provider: cli-mock
            model: cli-mock
        pairing:
          enabled: true

    - id: as1-telegram
      name: dsh-telegram
      config:
        mode: pairing
        accountId: ${yaml(accountId)}
        tokenEnv: DSH_TELEGRAM_BOT_TOKEN
        apiBase: https://api.telegram.org
`
  await writeFile(path, overlay, { mode: 0o600 })
  await chmod(path, 0o600)
}

async function bootProfile(dshSourceDir: string, profileName: string, dshHome: string): Promise<RuntimeContext> {
  const appBoot = await import(pathToFileURL(join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js')).href) as any
  const { provideCmdline } = await import(pathToFileURL(join(dshSourceDir, 'packages', 'boot', 'cmdline', 'lib', 'index.js')).href) as any
  const installAnchor = join(dshSourceDir, 'apps', 'cli', 'package.json')
  const profile = appBoot.loadProfile('evoforge-telegram-as1', profileName, installAnchor, dshHome)
  await appBoot.healProfilesModuleFallback({ installAnchor, profile, home: dshHome })
  const rootConfig = join(profile.dir, 'cordis.yml')
  await writeFile(rootConfig, '[]\n', { mode: 0o600 })
  const shippedPresetPatch = {
    id: 'agent-presets',
    config: {
      default: 'standard',
      roots: [{ path: join(dshSourceDir, 'apps', 'cli', 'config', 'agent-presets'), trust: 'system' }],
      includeUserRoot: false,
    },
  }
  return await appBoot.boot(
    'evoforge-telegram-as1',
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
  const agentModule = await import(pathToFileURL(join(dshSourceDir, 'packages', 'core', 'agent', 'lib', 'index.js')).href) as {
    agentEvents(ctx: unknown, agent: unknown): {
      waterfall(
        event: 'approval/request',
        request: { readonly toolName: string; readonly reason: string; readonly signal: AbortSignal },
        fallback: () => Promise<ApprovalOutcome>,
      ): Promise<ApprovalOutcome>
    }
  }
  return await agentModule.agentEvents(context, agent).waterfall('approval/request', {
    toolName: 'as1-real-telegram-protected-action',
    reason: 'Verify one exact real Telegram Approval card and once-only human decision.',
    signal: new AbortController().signal,
  }, () => Promise.resolve<ApprovalOutcome>('unavailable'))
}

function requireGateway(context: RuntimeContext): RuntimeGateway {
  const gateway = context.get('evoforge.gateway') as RuntimeGateway | undefined
  if (gateway === undefined) throw new Error('AS-1 production dsh-gateway did not load')
  return gateway
}

function readSessionEvents(session: RuntimeAgent['session']): readonly RuntimeEvent[] {
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  if (session.events !== undefined) return session.events
  throw new Error('DSH Session does not expose a readable event snapshot')
}

function countUserMessages(events: readonly RuntimeEvent[]): number {
  return events.filter(event => event.type === 'user/message').length
}

function countExactUserText(events: readonly RuntimeEvent[], expected: string): number {
  return events.filter(event => {
    if (event.type !== 'user/message' || typeof event.data !== 'object' || event.data === null) return false
    const content = (event.data as { readonly content?: unknown }).content
    return Array.isArray(content) && content.some(block => typeof block === 'object' && block !== null
      && (block as { readonly type?: unknown }).type === 'text'
      && (block as { readonly text?: unknown }).text === expected)
  }).length
}

function hasExactUserText(events: readonly RuntimeEvent[], expected: string): boolean {
  return countExactUserText(events, expected) > 0
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

async function eventually(predicate: () => boolean, timeoutMs: number, message: string): Promise<void> {
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
  await eventually(() => gateway.healthSnapshot(Date.now(), [routeId]).outbound.delivered >= before + 1, timeoutMs, message)
  const delivered = gateway.healthSnapshot(Date.now(), [routeId]).outbound.delivered
  if (delivered !== before + 1) throw new Error(`AS-1 expected exactly one new delivered effect, observed ${delivered - before}`)
  return delivered
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs) }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function runDsh(dshBin: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await execFile(process.execPath, [dshBin, ...args], { cwd, env, encoding: 'utf8', timeout: 120_000 })
  } catch (error: unknown) {
    const failure = error as { readonly stdout?: string; readonly stderr?: string }
    throw new Error(`AS-1 DSH command failed: ${boundedOutput(failure.stdout)} ${boundedOutput(failure.stderr)}`)
  }
}

async function expectCliHostStarts(dshBin: string, profile: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn(process.execPath, [dshBin, '--profile', profile, '--port', '0', '--no-open'], {
    cwd, env, stdio: ['ignore', 'ignore', 'ignore'],
  })
  const exited = new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>(resolveExit => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  const early = await Promise.race([
    exited.then(result => ({ kind: 'exit' as const, result })),
    new Promise<{ readonly kind: 'running' }>(resolveWait => setTimeout(() => resolveWait({ kind: 'running' }), 1_500)),
  ])
  if (early.kind === 'exit') throw new Error(`native DSH Host exited before readiness: ${JSON.stringify(early.result)}`)
  child.kill('SIGTERM')
  const result = await exited
  if (result.code !== 0 || result.signal !== null) throw new Error(`native DSH Host did not stop cleanly: ${JSON.stringify(result)}`)
}

async function withProcessEnvironment<T>(environment: NodeJS.ProcessEnv, operation: () => Promise<T>): Promise<T> {
  const restore = installProcessEnvironment(environment)
  try { return await operation() } finally { restore() }
}

function installProcessEnvironment(environment: NodeJS.ProcessEnv): () => void {
  const names = [
    'DSH_HOME', 'DSH_AGENTS_HOME', 'DSH_PERMISSION_MODE', 'DSH_TELEMETRY_DISABLED', 'DSH_TELEGRAM_BOT_TOKEN',
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
  if (canonical !== resolve(path)) throw new Error('AS-1 run directories must not traverse symlinks')
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

async function writeState(path: string, base: Omit<AcceptanceState, 'stage' | 'updatedAt'>, stage: string): Promise<void> {
  await writePrivateJson(path, { ...base, stage, updatedAt: new Date().toISOString() })
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function boundedError(error: unknown, config: RealTelegramExecutionConfig): string {
  let value = error instanceof Error ? error.message : String(error)
  for (const privateValue of [config.botToken, config.accountId]) value = value.replaceAll(privateValue, '[redacted]')
  return value.replace(/[\r\n]+/gu, ' ').slice(0, 512) || 'unknown AS-1 failure'
}

function boundedOutput(value: string | undefined): string {
  return (value ?? '').replace(/[\r\n]+/gu, ' ').slice(0, 256)
}

function yaml(value: string): string { return JSON.stringify(value) }

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd, encoding: 'utf8' })).stdout.trim()
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }
