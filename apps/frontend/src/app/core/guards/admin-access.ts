const ADMIN_ROLES = ['admin', 'system-admin', 'sys-admin', 'administrator'];

export function hasAdminBypass(userRoles: string[] = [], isAdmin?: boolean): boolean {
  return isAdmin === true || userRoles.some((role: string) => ADMIN_ROLES.includes(role.toLowerCase()));
}
