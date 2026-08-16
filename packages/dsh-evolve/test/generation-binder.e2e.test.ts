import { execFile as execFileCallback } from 'node:child_process'
import { chmod, cp, readFile, readdir, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import * as EvolvePlugin from '../src/index.js'
import type { EvolutionStore } from '../src/generation-store.js'
import { openDeliveryOutcomeStore } from '../src/delivery-outcome-monitor.js'
import { hashTree, sha256 } from '../src/hash.js'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (path) => {
    await makeWritable(path)
    await rm(path, { force: true, recursive: true })
  }))
})

describe.skipIf(process.platform !== 'darwin')('Session Generation binder', () => {
  it('auto-promotes only an allowlisted append-only clear win after late native Jobs composition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-auto-promote-'))
    temporaryRoots.push(root)
    const repository = join(root, 'source')
    const revision = await commitSkill(repository, 'Baseline body.', 'baseline reference')
    const runRoot = await writeCompletedReviewRun(root, repository, true)
    const ctx = await bootStorage(await writeStorageConfig(root))
    const adapter = await installAgentRuntime(ctx)
    await ctx.plugin(EvolvePlugin, {
      cacheRoot: join(root, 'cache'),
      sources: [{
        name: 'stable-evolved-skill',
        repository,
        path: 'skills/stable-evolved-skill',
      }],
      supervisor: { runRoots: [runRoot], scanIntervalMs: 30_000 },
      autoPromote: { skills: ['stable-evolved-skill'] },
    })
    const store = ctx.get('evoforge.evolution') as EvolutionStore | undefined
    const skills = ctx.get('skills') as {
      get(name: string, options: { cwd?: string; scope?: object }): Promise<{ content: string } | undefined>
    } | undefined
    if (store === undefined || skills === undefined) throw new Error('automatic services did not load')
    const liveNative = await createAndRunAgent(ctx, 'auto-live-native', root)
    const requestsBeforeAutomatic = adapter.requests.length

    const jobsModule = await import(pathToFileURL(
      join(dshSourceDir, 'packages', 'jobs', 'jobs-local', 'lib', 'index.js'),
    ).href)
    await ctx.plugin(jobsModule.default)
    const active = await waitForActiveGeneration(store)

    expect(active.policyVersion).toBe('auto-clear-instruction-v1')
    expect(adapter.requests).toHaveLength(requestsBeforeAutomatic)
    expect(store.getSessionGeneration(identityOf(liveNative))).toBeUndefined()
    expect(JSON.parse(await readFile(join(runRoot, 'sealed-candidate', 'review-state.json'), 'utf8')))
      .toMatchObject({ status: 'approved', actor: 'auto-clear-instruction-v1', generationId: active.id })
    expect(await git(repository, 'rev-parse', 'HEAD')).toBe(revision.commit)
    expect(await git(repository, 'status', '--porcelain')).toBe('')

    const futureEvolved = await createAndRunAgent(ctx, 'auto-future-evolved', root)
    expect((await skills.get('stable-evolved-skill', { cwd: root, scope: futureEvolved }))?.content)
      .toContain('Verify the exact browser flow before completion.')
    expect(adapter.requests).toHaveLength(requestsBeforeAutomatic + 1)
    await ctx.fiber.dispose()
  })

  it('reviews, publishes, and explicitly promotes one sealed Candidate without moving the user branch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-review-publish-'))
    temporaryRoots.push(root)
    const repository = join(root, 'source')
    const revision = await commitSkill(repository, 'Baseline body.', 'baseline reference')
    const runRoot = await writeCompletedReviewRun(root, repository)
    const ctx = await bootStorage(await writeStorageConfig(root))
    const adapter = await installAgentRuntime(ctx)
    await ctx.plugin(EvolvePlugin, {
      cacheRoot: join(root, 'cache'),
      sources: [{
        name: 'stable-evolved-skill',
        repository,
        path: 'skills/stable-evolved-skill',
      }],
      supervisor: { runRoots: [runRoot], scanIntervalMs: 30_000 },
    })
    const commandsModule = await import(pathToFileURL(
      join(dshSourceDir, 'packages', 'interaction', 'commands', 'lib', 'index.js'),
    ).href)
    await ctx.plugin(commandsModule.default)
    const commands = ctx.get('commands') as {
      execute(agent: object, line: string, signal: AbortSignal): Promise<{
        result: { kind: string; text?: string }
      } | undefined>
    } | undefined
    const skills = ctx.get('skills') as {
      get(name: string, options: { cwd?: string; scope?: object }): Promise<{ content: string } | undefined>
    } | undefined
    const store = ctx.get('evoforge.evolution') as EvolutionStore | undefined
    if (commands === undefined || skills === undefined || store === undefined) {
      throw new Error('review services did not load')
    }
    const liveNative = await createAndRunAgent(ctx, 'review-live-native', root)
    const requestsBeforeReview = adapter.requests.length

    const paused = await commands.execute(liveNative, '/evolve pause', new AbortController().signal)
    expect(paused?.result).toMatchObject({ kind: 'success' })
    expect(store.isRecoveryPaused()).toBe(true)
    const pausedStatus = await commands.execute(liveNative, '/evolve status', new AbortController().signal)
    expect(pausedStatus?.result.text).toContain('Resident recovery: paused')
    const resumed = await commands.execute(liveNative, '/evolve resume', new AbortController().signal)
    expect(resumed?.result).toMatchObject({ kind: 'success' })
    expect(store.isRecoveryPaused()).toBe(false)
    expect(adapter.requests).toHaveLength(requestsBeforeReview)

    const list = await commands.execute(liveNative, '/evolve review', new AbortController().signal)
    const reviewId = /^- ([a-f0-9]{64}) /m.exec(list?.result.text ?? '')?.[1]
    expect(reviewId).toBeDefined()
    if (reviewId === undefined) throw new Error('review id missing')
    const detail = await commands.execute(
      liveNative,
      `/evolve review ${reviewId}`,
      new AbortController().signal,
    )
    expect(detail?.result.text).toContain('held-out-browser fail→pass checks 2/2')
    const approved = await commands.execute(
      liveNative,
      `/evolve review ${reviewId} approve exact held-out improvement`,
      new AbortController().signal,
    )
    const generationId = /Inactive Generation: ([a-f0-9]{64})/.exec(approved?.result.text ?? '')?.[1]
    expect(generationId).toBeDefined()
    if (generationId === undefined) throw new Error('generation id missing')
    expect(adapter.requests).toHaveLength(requestsBeforeReview)
    expect(await git(repository, 'rev-parse', 'HEAD')).toBe(revision.commit)
    expect(await git(repository, 'status', '--porcelain')).toBe('')
    expect(await git(repository, 'rev-parse', `refs/evoforge/generations/${reviewId}`))
      .not.toBe(revision.commit)

    await commands.execute(
      liveNative,
      `/evolve promote ${generationId}`,
      new AbortController().signal,
    )
    const futureEvolved = await createAndRunAgent(ctx, 'review-future-evolved', root)
    expect(await skills.get('stable-evolved-skill', { cwd: root, scope: liveNative })).toBeUndefined()
    expect((await skills.get('stable-evolved-skill', { cwd: root, scope: futureEvolved }))?.content)
      .toContain('Verify the exact browser flow before completion.')
    expect(adapter.requests).toHaveLength(requestsBeforeReview + 1)
    await ctx.fiber.dispose()
  })

  it('uses a late-composed native /evolve command without a model call or live Session drift', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-command-binder-'))
    temporaryRoots.push(root)
    const repository = join(root, 'source')
    const revision = await commitSkill(repository, 'Command-promoted body.', 'command reference')
    const ctx = await bootStorage(await writeStorageConfig(root))
    const adapter = await installAgentRuntime(ctx)
    const evolveFiber = await ctx.plugin(EvolvePlugin, {
      cacheRoot: join(root, 'cache'),
      sources: [{
        name: 'stable-evolved-skill',
        repository,
        path: 'skills/stable-evolved-skill',
      }],
    })
    const commandsModule = await import(pathToFileURL(
      join(dshSourceDir, 'packages', 'interaction', 'commands', 'lib', 'index.js'),
    ).href)
    await ctx.plugin(commandsModule.default)
    const commands = ctx.get('commands') as {
      execute(agent: object, line: string, signal: AbortSignal): Promise<{
        result: { kind: string; text?: string }
      } | undefined>
      list(agent: object): ReadonlyArray<{ name: string }>
    } | undefined
    const store = ctx.get('evoforge.evolution') as EvolutionStore | undefined
    const skills = ctx.get('skills') as {
      get(name: string, options: { cwd?: string; scope?: object }): Promise<{ content: string } | undefined>
    } | undefined
    if (commands === undefined || store === undefined || skills === undefined) {
      throw new Error('command test services did not load')
    }
    const liveAgent = await createAndRunAgent(ctx, 'command-live-native', root)
    const firstRequest = requestView(adapter.requests[0])
    const generation = (await store.publishGeneration(generationInput(revision))).generation

    expect(commands.list(liveAgent)).toContainEqual(expect.objectContaining({ name: 'evolve' }))
    const requestsBeforePromote = adapter.requests.length
    const promoted = await commands.execute(
      liveAgent,
      `/evolve promote ${generation.id}`,
      new AbortController().signal,
    )
    expect(promoted?.result).toMatchObject({
      kind: 'success',
      text: expect.stringContaining('Existing Sessions were not changed.'),
    })
    expect(adapter.requests).toHaveLength(requestsBeforePromote)
    expect(store.getSessionGeneration(identityOf(liveAgent))).toBeUndefined()

    const futureAgent = await createAndRunAgent(ctx, 'command-future-evolved', root)
    expect((await skills.get('stable-evolved-skill', { cwd: root, scope: futureAgent }))?.content)
      .toBe('Command-promoted body.')
    const requestsBeforeRollback = adapter.requests.length
    const rolledBack = await commands.execute(
      liveAgent,
      '/evolve rollback',
      new AbortController().signal,
    )
    expect(rolledBack?.result).toMatchObject({ kind: 'success', text: expect.stringContaining('Active: native DSH') })
    expect(adapter.requests).toHaveLength(requestsBeforeRollback)

    const nativeAgain = await createAndRunAgent(ctx, 'command-future-native', root)
    expect(await skills.get('stable-evolved-skill', { cwd: root, scope: nativeAgain })).toBeUndefined()
    await runAgentTurn(liveAgent, 'continue after host release commands')
    const secondLiveRequest = requestView(adapter.requests.at(-1))
    expect(secondLiveRequest.tools).toEqual(firstRequest.tools)
    expect(secondLiveRequest.messages.slice(0, firstRequest.messages.length))
      .toEqual(firstRequest.messages)
    await evolveFiber.dispose()
    expect(commands.list(liveAgent)).not.toContainEqual(expect.objectContaining({ name: 'evolve' }))
    await ctx.fiber.dispose()
  })

  it('keeps an already-started native Agent and its child native after the first promotion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-native-generation-binder-'))
    temporaryRoots.push(root)
    const repository = join(root, 'source')
    const revision = await commitSkill(repository, 'First evolved body.', 'first reference')
    const ctx = await bootStorage(await writeStorageConfig(root))
    const adapter = await installAgentRuntime(ctx)
    await ctx.plugin(EvolvePlugin, {
      cacheRoot: join(root, 'cache'),
      sources: [{
        name: 'stable-evolved-skill',
        repository,
        path: 'skills/stable-evolved-skill',
      }],
    })
    const store = ctx.get('evoforge.evolution') as EvolutionStore | undefined
    const skills = ctx.get('skills') as {
      get(name: string, options: { cwd?: string; scope?: object }): Promise<{ content: string } | undefined>
    } | undefined
    if (store === undefined || skills === undefined) throw new Error('required service did not load')

    const nativeAgent = await createAndRunAgent(ctx, 'native-before-first-promotion', root)
    const firstNativeRequest = requestView(adapter.requests[0])
    const generation = (await store.publishGeneration(generationInput(revision))).generation
    await store.promoteGeneration(generation.id)
    const nativeChild = await createAndRunAgent(
      ctx,
      'native-child-after-first-promotion',
      root,
      'native-before-first-promotion',
    )
    const evolvedAgent = await createAndRunAgent(ctx, 'evolved-after-first-promotion', root)
    await runAgentTurn(nativeAgent, 'remain native after first promotion')
    const secondNativeRequest = requestView(adapter.requests[3])

    expect(store.getSessionGeneration(identityOf(nativeAgent))).toBeUndefined()
    expect(store.getSessionGeneration(identityOf(nativeChild))).toBeUndefined()
    expect(store.getSessionGeneration(identityOf(evolvedAgent))?.id).toBe(generation.id)
    expect(await skills.get('stable-evolved-skill', { cwd: root, scope: nativeAgent }))
      .toBeUndefined()
    expect(await skills.get('stable-evolved-skill', { cwd: root, scope: nativeChild }))
      .toBeUndefined()
    expect((await skills.get('stable-evolved-skill', { cwd: root, scope: evolvedAgent }))?.content)
      .toBe('First evolved body.')
    expect(secondNativeRequest.tools).toEqual(firstNativeRequest.tools)
    expect(secondNativeRequest.messages.slice(0, firstNativeRequest.messages.length))
      .toEqual(firstNativeRequest.messages)
    await ctx.fiber.dispose()
  })

  it('refuses to move the active pointer to a Generation whose configured Git tree is not exact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-generation-integrity-'))
    temporaryRoots.push(root)
    const repository = join(root, 'source')
    const cacheRoot = join(root, 'cache')
    const sessionsRoot = join(root, 'sessions')
    const revision = await commitSkill(repository, 'Exact body.', 'exact reference')
    const configPath = await writeStorageConfig(root)
    const ctx = await bootStorage(configPath)
    await installAgentRuntime(ctx, sessionsRoot)
    await ctx.plugin(EvolvePlugin, {
      cacheRoot,
      sources: [{
        name: 'stable-evolved-skill',
        repository,
        path: 'skills/stable-evolved-skill',
      }],
    })
    const store = ctx.get('evoforge.evolution') as EvolutionStore | undefined
    if (store === undefined) throw new Error('evolution service did not load')
    const invalid = (await store.publishGeneration({
      ...generationInput(revision),
      artifacts: [{
        kind: 'skill' as const,
        name: 'stable-evolved-skill',
        gitCommit: revision.commit,
        treeHash: 'f'.repeat(64),
      }],
    })).generation

    await expect(store.promoteGeneration(invalid.id)).rejects.toThrow('Git tree mismatch')
    expect(store.getActiveGeneration()).toBeUndefined()

    const valid = (await store.publishGeneration({
      ...generationInput(revision),
      createdAt: 1_723_456_789_001,
    })).generation
    await store.promoteGeneration(valid.id)
    const cachedTree = join(cacheRoot, revision.treeHash, 'tree')
    await chmod(cachedTree, 0o755)
    await writeFile(join(cachedTree, 'rogue.md'), 'not in Git\n')
    await chmod(cachedTree, 0o555)
    const corruptedAgent = await createAndRunAgent(ctx, 'corrupted-cache-session', root)
    const skills = ctx.get('skills') as {
      get(name: string, options: { cwd?: string; scope?: object }): Promise<{ content: string } | undefined>
    } | undefined
    expect(await skills?.get('stable-evolved-skill', { cwd: root, scope: corruptedAgent }))
      .toBeUndefined()
    await ctx.sessions.flush(corruptedAgent.session)
    await ctx.fiber.dispose()

    await chmod(cachedTree, 0o755)
    await rm(join(cachedTree, 'rogue.md'))
    await chmod(cachedTree, 0o555)
    const resumedCtx = await bootStorage(configPath)
    await installAgentRuntime(resumedCtx, sessionsRoot)
    await resumedCtx.plugin(EvolvePlugin, {
      cacheRoot,
      sources: [{
        name: 'stable-evolved-skill',
        repository,
        path: 'skills/stable-evolved-skill',
      }],
    })
    const resumedAgent = await resumeAndRunAgent(resumedCtx, 'corrupted-cache-session')
    const freshAgent = await createAndRunAgent(resumedCtx, 'fresh-after-cache-repair', root)
    const resumedSkills = resumedCtx.get('skills') as typeof skills
    expect(await resumedSkills?.get('stable-evolved-skill', { cwd: root, scope: resumedAgent }))
      .toBeUndefined()
    expect((await resumedSkills?.get('stable-evolved-skill', { cwd: root, scope: freshAgent }))
      ?.content).toBe('Exact body.')
    await resumedCtx.fiber.dispose()
  })

  it('pins real Agents to immutable Git-backed Skill bodies while future Sessions follow promotion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-generation-binder-'))
    temporaryRoots.push(root)
    const repository = join(root, 'source')
    const cacheRoot = join(root, 'cache')
    const sessionsRoot = join(root, 'sessions')
    const configPath = await writeStorageConfig(root)
    const oldRevision = await commitSkill(repository, 'Old body.', 'old reference')
    const newRevision = await commitSkill(repository, 'New body.', 'new reference')
    const ctx = await bootStorage(configPath)

    const adapter = await installAgentRuntime(ctx, sessionsRoot)
    await ctx.plugin(EvolvePlugin, {
      cacheRoot,
      sources: [{
        name: 'stable-evolved-skill',
        repository,
        path: 'skills/stable-evolved-skill',
      }],
    })

    const store = ctx.get('evoforge.evolution') as EvolutionStore | undefined
    const skills = ctx.get('skills') as {
      get(name: string, options: { cwd?: string; scope?: object }): Promise<{
        content: string
        resourceBase?: { kind: string; path?: string }
      } | undefined>
    } | undefined
    if (store === undefined || skills === undefined) throw new Error('required service did not load')

    const oldGeneration = (await store.publishGeneration(generationInput(oldRevision))).generation
    await store.promoteGeneration(oldGeneration.id)
    const oldAgent = await createAndRunAgent(ctx, 'old-session', root)
    const oldIdentity = identityOf(oldAgent)
    const oldSkill = await skills.get('stable-evolved-skill', { cwd: root, scope: oldAgent })

    const newGeneration = (await store.publishGeneration({
      ...generationInput(newRevision),
      parentId: oldGeneration.id,
      createdAt: 1_723_456_789_001,
    })).generation
    await store.promoteGeneration(newGeneration.id)
    const newAgent = await createAndRunAgent(ctx, 'new-session', root)
    const childAgent = await createAndRunAgent(ctx, 'child-session', root, 'old-session')
    await runAgentTurn(oldAgent, 'run after promotion')
    const newIdentity = identityOf(newAgent)
    const oldSkillAfterPromotion = await skills.get('stable-evolved-skill', { cwd: root, scope: oldAgent })
    const newSkill = await skills.get('stable-evolved-skill', { cwd: root, scope: newAgent })
    const childSkill = await skills.get('stable-evolved-skill', { cwd: root, scope: childAgent })

    await store.rollbackGeneration()
    const rollbackAgent = await createAndRunAgent(ctx, 'rollback-session', root)
    const rollbackSkill = await skills.get('stable-evolved-skill', { cwd: root, scope: rollbackAgent })
    const oldSkillAfterRollback = await skills.get('stable-evolved-skill', { cwd: root, scope: oldAgent })
    const newSkillAfterRollback = await skills.get('stable-evolved-skill', { cwd: root, scope: newAgent })

    expect(store.getSessionGeneration(oldIdentity)?.id).toBe(oldGeneration.id)
    expect(store.getSessionGeneration(newIdentity)?.id).toBe(newGeneration.id)
    expect(store.getSessionGeneration(identityOf(childAgent))?.id).toBe(oldGeneration.id)
    expect(store.getSessionGeneration(identityOf(rollbackAgent))?.id).toBe(oldGeneration.id)
    expect(oldSkill?.content).toBe('Old body.')
    expect(oldSkillAfterPromotion?.content).toBe('Old body.')
    expect(newSkill?.content).toBe('New body.')
    expect(childSkill?.content).toBe('Old body.')
    expect(rollbackSkill?.content).toBe('Old body.')
    expect(oldSkillAfterRollback?.content).toBe('Old body.')
    expect(newSkillAfterRollback?.content).toBe('New body.')
    const firstOldRequest = requestView(adapter.requests[0])
    const secondOldRequest = requestView(adapter.requests[3])
    expect(JSON.stringify(firstOldRequest.messages)).toContain('stable-evolved-skill')
    expect(secondOldRequest.tools).toEqual(firstOldRequest.tools)
    expect(secondOldRequest.messages.slice(0, firstOldRequest.messages.length))
      .toEqual(firstOldRequest.messages)
    expect(oldSkill?.resourceBase?.kind).toBe('directory')
    expect(newSkill?.resourceBase?.kind).toBe('directory')
    expect(await readFile(join(oldSkill?.resourceBase?.path ?? '', 'references', 'note.md'), 'utf8'))
      .toBe('old reference\n')
    expect(await readFile(join(newSkill?.resourceBase?.path ?? '', 'references', 'note.md'), 'utf8'))
      .toBe('new reference\n')

    await ctx.sessions.flush(newAgent.session)
    await ctx.fiber.dispose()

    const resumedCtx = await bootStorage(configPath)
    await installAgentRuntime(resumedCtx, sessionsRoot)
    await resumedCtx.plugin(EvolvePlugin, {
      cacheRoot,
      sources: [{
        name: 'stable-evolved-skill',
        repository,
        path: 'skills/stable-evolved-skill',
      }],
    })
    const resumedAgent = await resumeAndRunAgent(resumedCtx, 'new-session')
    const resumedStore = resumedCtx.get('evoforge.evolution') as EvolutionStore | undefined
    const resumedSkills = resumedCtx.get('skills') as typeof skills
    expect(resumedStore?.getSessionGeneration(identityOf(resumedAgent))?.id).toBe(newGeneration.id)
    expect((await resumedSkills?.get('stable-evolved-skill', { cwd: root, scope: resumedAgent }))?.content)
      .toBe('New body.')
    await resumedCtx.fiber.dispose()
  })

  it('continues the real native Agent turn without an evolved overlay when the durable pin write fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-generation-pin-failure-'))
    temporaryRoots.push(root)
    const repository = join(root, 'source')
    const revision = await commitSkill(repository, 'Candidate body.', 'candidate reference')
    const ctx = await bootStorage(await writeStorageConfig(root))
    await installAgentRuntime(ctx)
    await ctx.plugin(EvolvePlugin, {
      cacheRoot: join(root, 'cache'),
      sources: [{
        name: 'stable-evolved-skill',
        repository,
        path: 'skills/stable-evolved-skill',
      }],
    })
    const store = ctx.get('evoforge.evolution') as EvolutionStore | undefined
    const skills = ctx.get('skills') as {
      get(name: string, options: { cwd?: string; scope?: object }): Promise<unknown>
    } | undefined
    if (store === undefined || skills === undefined) throw new Error('required service did not load')
    const generation = (await store.publishGeneration(generationInput(revision))).generation
    await store.promoteGeneration(generation.id)

    await chmod(join(root, 'storage'), 0o500)
    const agent = await createAndRunAgent(ctx, 'pin-failure-session', root)

    expect(store.getSessionGeneration(identityOf(agent))).toBeUndefined()
    expect(await skills.get('stable-evolved-skill', { cwd: root, scope: agent })).toBeUndefined()
    expect(agent.session.events.some((event: { type: string }) => event.type === 'assistant/message')).toBe(true)
    await chmod(join(root, 'storage'), 0o700)
    await ctx.fiber.dispose()
  })

  it('removes scoped providers from live Agents when the runtime plugin is hot-unloaded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-generation-hot-unload-'))
    temporaryRoots.push(root)
    const repository = join(root, 'source')
    const revision = await commitSkill(repository, 'Unload body.', 'unload reference')
    const ctx = await bootStorage(await writeStorageConfig(root))
    await installAgentRuntime(ctx)
    const evolveFiber = await ctx.plugin(EvolvePlugin, {
      cacheRoot: join(root, 'cache'),
      sources: [{
        name: 'stable-evolved-skill',
        repository,
        path: 'skills/stable-evolved-skill',
      }],
    })
    const store = ctx.get('evoforge.evolution') as EvolutionStore | undefined
    const skills = ctx.get('skills') as {
      get(name: string, options: { cwd?: string; scope?: object }): Promise<{ content: string } | undefined>
    } | undefined
    if (store === undefined || skills === undefined) throw new Error('required service did not load')
    const generation = (await store.publishGeneration(generationInput(revision))).generation
    await store.promoteGeneration(generation.id)
    const agent = await createAndRunAgent(ctx, 'hot-unload-session', root)
    expect((await skills.get('stable-evolved-skill', { cwd: root, scope: agent }))?.content)
      .toBe('Unload body.')

    await evolveFiber.dispose()

    expect(ctx.get('evoforge.evolution')).toBeUndefined()
    expect(await skills.get('stable-evolved-skill', { cwd: root, scope: agent })).toBeUndefined()
    await runAgentTurn(agent, 'continue natively after unload')
    expect(agent.session.events.some((event: { type: string }) => event.type === 'assistant/message')).toBe(true)
    await ctx.fiber.dispose()
  })

  it('observes a pinned native ToolRuntime result once and recovers it after plugin reload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-delivery-result-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const ctx = await bootStorage(configPath)
    const adapter = await installAgentRuntime(ctx)
    const evolveFiber = await ctx.plugin(EvolvePlugin, { cacheRoot: join(root, 'cache') })
    const packages = (path: string) => pathToFileURL(
      join(dshSourceDir, 'packages', path, 'lib', 'index.js'),
    ).href
    const [llm, tools, commands] = await Promise.all([
      import(packages('llm/llm')),
      import(packages('core/tools')),
      import(packages('interaction/commands')),
    ])
    await ctx.plugin(commands.default)
    const agent = await createAndRunAgent(ctx, 'delivery-outcome-session', root)
    const modelRequestsBeforeDelivery = adapter.requests.length
    const unregister = ctx.tools.register(tools.defineTool({
      name: 'complete_delivery',
      description: 'Pinned native outcome fixture.',
      parameters: {},
      output: {
        schema: { type: 'json' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: () => ({
        schemaVersion: 1,
        status: 'passed',
        reason: 'verified',
        goal: { id: 'native-goal', revision: 3, phase: 'complete' },
        artifact: { kind: 'git-commit', commit: 'b'.repeat(40), branch: 'feature/native' },
        repository: { worktree: '/must/not/persist' },
        checks: [{ name: 'native-check', stdoutPreview: 'must-not-persist' }],
      }),
    }))
    const execution = {
      callId: llm.CallId('native-delivery-outcome'),
      name: 'complete_delivery',
      arguments: {},
      agent,
      signal: new AbortController().signal,
    }

    await expect(ctx.tools.execute(execution)).resolves.toMatchObject({ isError: false })
    await expect(ctx.tools.execute(execution)).resolves.toMatchObject({ isError: false })
    const status = await waitForEvolutionStatus(ctx, agent, 'Delivery outcomes: 1 total')
    expect(status).toContain('Active selection outcomes (native DSH): 1 total (1 passed, 0 failed, 0 unknown)')
    expect(adapter.requests).toHaveLength(modelRequestsBeforeDelivery)

    unregister()
    await evolveFiber.dispose()
    const recovered = await openDeliveryOutcomeStore(ctx.storageDomain)
    try {
      expect(recovered.summarize()).toEqual({
        all: { total: 1, passed: 1, failed: 0, unknown: 0 },
        selected: { total: 1, passed: 1, failed: 0, unknown: 0 },
      })
    } finally {
      await recovered.close()
      await ctx.fiber.dispose()
    }
  })

  it('leaves persisted Session and Goal facts readable by native DSH after plugin removal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-generation-removal-'))
    temporaryRoots.push(root)
    const repository = join(root, 'source')
    const sessionsRoot = join(root, 'sessions')
    const configPath = await writeStorageConfig(root)
    const revision = await commitSkill(repository, 'Removable body.', 'removable reference')
    const evolvedCtx = await bootStorage(configPath)
    await installAgentRuntime(evolvedCtx, sessionsRoot)
    await evolvedCtx.plugin(EvolvePlugin, {
      cacheRoot: join(root, 'cache'),
      sources: [{
        name: 'stable-evolved-skill',
        repository,
        path: 'skills/stable-evolved-skill',
      }],
    })
    const store = evolvedCtx.get('evoforge.evolution') as EvolutionStore | undefined
    const goals = evolvedCtx.get('goals') as {
      create(agent: object, request: { objective: string }): { objective: string }
    } | undefined
    if (store === undefined || goals === undefined) throw new Error('required service did not load')
    const generation = (await store.publishGeneration(generationInput(revision))).generation
    await store.promoteGeneration(generation.id)
    const evolvedAgent = await createAndRunAgent(evolvedCtx, 'removable-session', root)
    expect(goals.create(evolvedAgent, { objective: 'Persist without EvoForge.' }).objective)
      .toBe('Persist without EvoForge.')
    await evolvedCtx.sessions.flush(evolvedAgent.session)
    await evolvedCtx.fiber.dispose()

    const nativeCtx = await bootStorage(configPath)
    await installAgentRuntime(nativeCtx, sessionsRoot)
    const session = await import(
      pathToFileURL(join(dshSourceDir, 'packages', 'core', 'session', 'lib', 'index.js')).href
    )
    const nativeHandle = await nativeCtx.agents.resume({
      resumeSessionId: session.SessionId('removable-session'),
      agentOptions: { provider: 'fixed', model: 'fixed' },
    })
    const nativeGoals = nativeCtx.get('goals') as {
      get(agent: object): { objective: string } | undefined
    } | undefined
    expect(nativeCtx.get('evoforge.evolution')).toBeUndefined()
    expect(nativeHandle.agent.session.events.some((event: { type: string }) => event.type === 'assistant/message')).toBe(true)
    expect(nativeGoals?.get(nativeHandle.agent)?.objective).toBe('Persist without EvoForge.')
    await nativeCtx.fiber.dispose()
  })
})

interface GitRevision {
  commit: string
  treeHash: string
}

function generationInput(revision: GitRevision) {
  return {
    createdAt: 1_723_456_789_000,
    artifacts: [{
      kind: 'skill' as const,
      name: 'stable-evolved-skill',
      gitCommit: revision.commit,
      treeHash: revision.treeHash,
    }],
    evaluatorVersion: 'binder-e2e-v1',
    policyVersion: 'p0b.1',
    compositionFingerprint: 'b'.repeat(64),
  }
}

async function writeCompletedReviewRun(
  root: string,
  repository: string,
  automatic = false,
): Promise<string> {
  const runRoot = join(root, 'runs')
  const runDir = join(runRoot, 'sealed-candidate')
  const skillDir = join(repository, 'skills', 'stable-evolved-skill')
  const candidateDir = join(root, 'review-candidate-tree')
  await mkdir(runDir, { recursive: true })
  await cp(skillDir, candidateDir, { recursive: true })
  const baseline = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
  const proposed = `${baseline.trimEnd()}\n\nVerify the exact browser flow before completion.\n`
  await writeFile(join(candidateDir, 'SKILL.md'), proposed)
  const proposal = {
    claim: 'Require exact browser verification before completion',
    files: [{ path: 'SKILL.md', content: proposed }],
  }
  const runId = '7'.repeat(64)
  const reportPath = join(runDir, 'report.json')
  const baseTreeHash = await hashTree(skillDir)
  const candidateTreeHash = await hashTree(candidateDir)
  await writeFile(join(runDir, 'run-state.json'), `${JSON.stringify({
    schemaVersion: 1,
    runId,
    phase: 'complete',
    startedAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:01:00.000Z',
    identity: {
      baseTreeHash,
      casePackHash: '8'.repeat(64),
      dshRevision: 'fixture',
      evaluatorVersion: 'review-e2e-v1',
      modelConfigHash: '9'.repeat(64),
      modelRoute: 'fixture-model',
      skillName: 'stable-evolved-skill',
    },
    resumeInputs: { skillDir, casePackDir: join(root, 'case-pack') },
    proposal,
    proposalHash: sha256(JSON.stringify(proposal)),
    modelUsage: { inputTokens: 120, outputTokens: 32 },
    outcome: { kind: 'complete', reportPath, summary: 'promote: held-out improvement' },
  }, null, 2)}\n`)
  await writeFile(reportPath, `${JSON.stringify({
    schemaVersion: 1,
    run: { id: runId, status: 'complete' },
    subject: { skillName: 'stable-evolved-skill', baseTreeHash, unchanged: true },
    candidate: {
      id: candidateTreeHash.slice(0, 16),
      treeHash: candidateTreeHash,
      parentTreeHash: baseTreeHash,
      claim: proposal.claim,
      changedFiles: ['SKILL.md'],
    },
    epoch: { evaluatorVersion: 'review-e2e-v1' },
    budget: { inputTokens: 120, outputTokens: 32 },
    trial: { count: 4 },
    cases: [{
      id: 'held-out-browser',
      baseline: 'fail',
      candidate: 'pass',
      checks: [{ name: 'browser', passed: true }, { name: 'composition', passed: true }],
    }],
    composition: automatic
      ? {
          baselineFingerprint: 'a'.repeat(64),
          candidateFingerprint: 'a'.repeat(64),
          stable: true,
        }
      : { candidateFingerprint: 'a'.repeat(64) },
    decision: {
      recommendation: 'promote',
      reasons: ['candidate passed sealed held-out case'],
      limitations: [automatic
        ? 'P0A.3 uses a keyless scripted model through one real assembled DSH path on macOS'
        : 'one deterministic held-out case'],
    },
  }, null, 2)}\n`)
  return runRoot
}

async function commitSkill(repository: string, body: string, reference: string): Promise<GitRevision> {
  await mkdir(join(repository, 'skills', 'stable-evolved-skill', 'references'), { recursive: true })
  try {
    await git(repository, 'rev-parse', '--git-dir')
  } catch {
    await git(repository, 'init', '--quiet')
  }
  await writeFile(join(repository, 'skills', 'stable-evolved-skill', 'SKILL.md'), [
    '---',
    'name: stable-evolved-skill',
    'description: An immutable Session-scoped test Skill.',
    '---',
    '',
    body,
    '',
  ].join('\n'))
  await writeFile(join(repository, 'skills', 'stable-evolved-skill', 'references', 'note.md'), `${reference}\n`)
  await git(repository, 'add', 'skills/stable-evolved-skill')
  await git(
    repository,
    '-c', 'user.name=EvoForge Test',
    '-c', 'user.email=evoforge@example.invalid',
    'commit', '--quiet', '-m', body,
  )
  return {
    commit: await git(repository, 'rev-parse', 'HEAD'),
    treeHash: await git(repository, 'rev-parse', 'HEAD:skills/stable-evolved-skill'),
  }
}

async function git(repository: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', ['-C', repository, ...args], { encoding: 'utf8' })
  return stdout.trim()
}

async function waitForActiveGeneration(store: EvolutionStore): Promise<NonNullable<ReturnType<EvolutionStore['getActiveGeneration']>>> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const active = store.getActiveGeneration()
    if (active !== undefined) return active
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('automatic promotion did not activate a Generation')
}

async function waitForEvolutionStatus(
  ctx: Awaited<ReturnType<typeof bootStorage>>,
  agent: object,
  expected: string,
): Promise<string> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const execution = await ctx.commands.execute(agent, '/evolve status', new AbortController().signal)
    const text = execution?.result.text ?? ''
    if (text.includes(expected)) return text
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`evolution status did not contain '${expected}'`)
}

async function installAgentRuntime(
  ctx: Awaited<ReturnType<typeof bootStorage>>,
  persistenceRoot?: string,
) {
  const packages = (path: string) => pathToFileURL(join(dshSourceDir, 'packages', path, 'lib', 'index.js')).href
  const [llm, session, systemPrompt, tools, skill, toolSkill, agent, goal, agentLoop, persistence] = await Promise.all([
    import(packages('llm/llm')),
    import(packages('core/session')),
    import(packages('core/system-prompt')),
    import(packages('core/tools')),
    import(packages('skill/skill')),
    import(packages('skill/tool-skill')),
    import(packages('core/agent')),
    import(packages('goal/goal')),
    import(packages('core/agent-loop')),
    import(packages('session/session-persistence-jsonl')),
  ])
  await ctx.plugin(llm.default)
  await ctx.plugin(session.default)
  await ctx.plugin(systemPrompt.default, { persona: 'Stable binder fixture.' })
  await ctx.plugin(tools.default)
  await ctx.plugin(skill.default)
  await ctx.plugin(toolSkill)
  await ctx.plugin(agent.default)
  await ctx.plugin(goal.default)
  await ctx.plugin(agentLoop.default, { agents: [] })
  if (persistenceRoot !== undefined) {
    await ctx.plugin(persistence.default, { root: persistenceRoot, compression: 'none' })
  }

  class FixedAdapter extends llm.LlmAdapter {
    requests: unknown[] = []

    resolveModel(provider: string, model: string) {
      return Promise.resolve({ provider, id: model, name: model })
    }

    async * stream(options: unknown) {
      this.requests.push(structuredClone(options))
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'ok' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const adapter = new FixedAdapter()
  ctx.llm.registerAdapter(['fixed'], adapter)
  return adapter
}

async function createAndRunAgent(
  ctx: Awaited<ReturnType<typeof bootStorage>>,
  sessionId: string,
  cwd: string,
  parentSessionId?: string,
) {
  const llm = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'llm', 'llm', 'lib', 'index.js')).href
  )
  const session = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'core', 'session', 'lib', 'index.js')).href
  )
  const handle = await ctx.agents.create({
    sessionId: session.SessionId(sessionId),
    agentOptions: { provider: 'fixed', model: 'fixed' },
    meta: {
      cwd,
      ...parentSessionId === undefined ? {} : { parentSession: session.SessionId(parentSessionId) },
    },
  })
  handle.agent.followup(llm.createUserMessage({
    content: [{ type: 'text', text: 'run one real step' }],
    source: { kind: 'user' },
  }))
  await handle.agent.whenIdle()
  return handle.agent
}

async function resumeAndRunAgent(
  ctx: Awaited<ReturnType<typeof bootStorage>>,
  sessionId: string,
) {
  const llm = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'llm', 'llm', 'lib', 'index.js')).href
  )
  const session = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'core', 'session', 'lib', 'index.js')).href
  )
  const handle = await ctx.agents.resume({
    resumeSessionId: session.SessionId(sessionId),
    agentOptions: { provider: 'fixed', model: 'fixed' },
  })
  handle.agent.followup(llm.createUserMessage({
    content: [{ type: 'text', text: 'run one resumed step' }],
    source: { kind: 'user' },
  }))
  await handle.agent.whenIdle()
  return handle.agent
}

async function runAgentTurn(
  agent: { followup(message: unknown): void; whenIdle(): Promise<void> },
  text: string,
): Promise<void> {
  const llm = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'llm', 'llm', 'lib', 'index.js')).href
  )
  agent.followup(llm.createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
}

function requestView(value: unknown): { messages: unknown[]; tools: unknown[] } {
  if (typeof value !== 'object' || value === null) throw new Error('adapter did not record a request object')
  const request = value as { messages?: unknown; tools?: unknown }
  if (!Array.isArray(request.messages) || !Array.isArray(request.tools)) {
    throw new Error('adapter request has no messages/tools arrays')
  }
  return { messages: request.messages, tools: request.tools }
}

function identityOf(agent: {
  session: { header: { id: string; createdAt: number; cwd?: string } }
}) {
  const { id, createdAt, cwd } = agent.session.header
  return {
    sessionId: String(id),
    createdAt,
    ...cwd === undefined ? {} : { cwd },
  }
}

async function writeStorageConfig(root: string): Promise<string> {
  const packageScope = join(root, 'node_modules', '@deepseek-ai')
  await mkdir(packageScope, { recursive: true })
  for (const [name, source] of [
    ['dsh-storage', join(dshSourceDir, 'packages', 'storage', 'storage')],
    ['dsh-storage-json', join(dshSourceDir, 'packages', 'storage', 'storage-json')],
    ['dsh-storage-domain', join(dshSourceDir, 'packages', 'storage', 'storage-domain')],
  ] as const) {
    await import('node:fs/promises').then(({ symlink }) => symlink(source, join(packageScope, name), 'dir'))
  }
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { id: 'storage', name: '@deepseek-ai/dsh-storage' },
    {
      id: 'storage-json',
      name: '@deepseek-ai/dsh-storage-json',
      config: { root: join(root, 'storage') },
    },
    {
      id: 'storage-domain',
      name: '@deepseek-ai/dsh-storage-domain',
      config: { backend: 'json' },
    },
  ], null, 2))
  return configPath
}

async function bootStorage(configPath: string) {
  const { boot } = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js')).href
  )
  return boot('dsh-evolve-generation-binder-test', configPath)
}

async function makeWritable(path: string): Promise<void> {
  await chmod(path, 0o755).catch(() => undefined)
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isDirectory()) await makeWritable(join(path, entry.name))
  }
}
