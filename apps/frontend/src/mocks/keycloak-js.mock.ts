export interface KeycloakTokenParsed {
  preferred_username?: string;
  sub?: string;
  [key: string]: string | undefined;
}

export interface KeycloakProfile {
  id?: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  [key: string]: string | undefined;
}

export interface KeycloakInstance {
  authenticated?: boolean;
  token?: string;
  idTokenParsed?: KeycloakTokenParsed;
  loadUserProfile?: () => Promise<KeycloakProfile>;
  login?: () => void;
  logout?: () => void;
  accountManagement?: () => void;
  realmAccess?: { roles: string[] };
  [key: string]: unknown;
}

const mockKeycloak = jest.fn(() => ({
  authenticated: true,
  token: 'mock-token',
  idTokenParsed: { preferred_username: 'user' },
  loadUserProfile: jest.fn().mockResolvedValue({}),
  login: jest.fn(),
  logout: jest.fn(),
  accountManagement: jest.fn(),
  realmAccess: { roles: [] }
})) as jest.Mock<KeycloakInstance>;

export default mockKeycloak;
