import { hasAdminBypass } from './admin-access';

describe('hasAdminBypass', () => {
  it('allows database admins without a Keycloak admin role', () => {
    expect(hasAdminBypass([], true)).toBe(true);
    expect(hasAdminBypass(['user'], true)).toBe(true);
  });

  it('allows known Keycloak admin role variants case-insensitively', () => {
    expect(hasAdminBypass(['ADMIN'], false)).toBe(true);
    expect(hasAdminBypass(['system-admin'], false)).toBe(true);
    expect(hasAdminBypass(['SYS-ADMIN'], false)).toBe(true);
    expect(hasAdminBypass(['Administrator'], false)).toBe(true);
  });

  it('rejects non-admin roles when the database admin flag is false', () => {
    expect(hasAdminBypass(['user', 'viewer'], false)).toBe(false);
    expect(hasAdminBypass(['super-admin'], false)).toBe(false);
    expect(hasAdminBypass([], false)).toBe(false);
  });
});
