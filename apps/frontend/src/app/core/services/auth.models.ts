export interface UserProfile {
  id?: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export interface DecodedToken {
  sub?: string;
  email?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  realm_access?: {
    roles: string[];
  };
  exp?: number;
}

export interface AuthExchangeResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  id_token?: string;
  refresh_token?: string;
}
