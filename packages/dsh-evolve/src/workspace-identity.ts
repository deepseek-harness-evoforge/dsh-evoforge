import type { Context } from '@deepseek-ai/cordis'

/** Resolve the one native Workspace authority for a Session cwd without creating anything. */
export async function workspaceIdForCwd(ctx: Context, cwd: string | undefined): Promise<string> {
  if (cwd === undefined) throw new Error('evolution requires a Session cwd owned by a registered Workspace')
  const registry = (ctx as unknown as {
    workspaceRegistry: { resolveByPath(path: string): Promise<{ id: unknown } | undefined> }
  }).workspaceRegistry
  const workspace = await registry.resolveByPath(cwd)
  if (workspace === undefined) {
    throw new Error(`Session cwd '${cwd}' is not owned by a registered Workspace`)
  }
  return String(workspace.id)
}
