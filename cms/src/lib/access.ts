/**
 * Role helpers for access control.
 *
 * `req.user` is a union of the auth collections: admin `Users` (which carry
 * `roles`) and signed-in `Accounts` (which do not). These read roles safely off
 * either shape, keeping `any` out of every access function.
 */

export function rolesOf(user: unknown): string[] {
  const roles = (user as { roles?: unknown } | null | undefined)?.roles
  return Array.isArray(roles) ? (roles as string[]) : []
}

export const isAdmin = (user: unknown): boolean => rolesOf(user).includes('admin')

export const isAdminOrEditor = (user: unknown): boolean => {
  const roles = rolesOf(user)
  return roles.includes('admin') || roles.includes('editor')
}
