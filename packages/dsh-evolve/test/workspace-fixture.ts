export const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
export const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'

export function runRoot(workspaceId: string, path: string): {
  workspaceId: string
  path: string
} {
  return { workspaceId, path }
}
