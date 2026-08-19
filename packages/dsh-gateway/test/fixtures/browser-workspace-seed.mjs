import { writeFile } from 'node:fs/promises'

export const name = 'evoforge-gateway-browser-workspace-seed'
export const inject = ['workspaceRegistry']

/**
 * Real-browser fixture: create or reuse one directory through DSH's native,
 * durable WorkspaceRegistry and expose only its id to the acceptance driver.
 * This fixture is test-only and never enters the published Gateway package.
 */
export async function apply(ctx, config) {
  const workspace = await ctx.workspaceRegistry.create(
    config.workspacePath,
    'EvoForge Gateway Browser Acceptance',
  )
  await writeFile(config.idFile, String(workspace.id), 'utf8')
}
