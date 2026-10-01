// These identities exist only in the disposable Keycloak realm and database.
export const FILE_ACCESS_USERS = [
  ...[0, 1, 2, 3].map(accessLevel => ({
    identity: `22222222-2222-4222-8222-22222222222${accessLevel}`,
    username: `file-access-${accessLevel}`,
    accessLevel,
    isAdmin: false
  })),
  {
    identity: '33333333-3333-4333-8333-333333333333',
    username: 'file-access-admin',
    accessLevel: 0,
    isAdmin: true
  }
];
