import type { Context } from '@deepseek-ai/cordis'

export const NATIVE_WORKSPACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/** Whether a value is a canonical native Workspace UUID. */
export function isWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && NATIVE_WORKSPACE_ID_PATTERN.test(value)
}

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
  const id = String(workspace.id)
  if (!isWorkspaceId(id)) throw new Error('native Workspace has an invalid id')
  return id
}
