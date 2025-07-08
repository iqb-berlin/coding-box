import { JwtPayload } from 'jwt-decode';
import * as jwt from 'jwt-decode';

/**
 * Validates a JWT token
 * @param token The token to validate
 * @returns An object indicating if the token is valid and the error type if it's not
 */
export function validateToken(token: string): { isValid: boolean; errorType?: 'token_expired' | 'token_invalid' } {
  if (!token) {
    return { isValid: false, errorType: 'token_invalid' };
  }

  try {
    const decoded: JwtPayload & { workspace: string } = jwt.jwtDecode(token);
    const currentTime = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < currentTime) {
      return { isValid: false, errorType: 'token_expired' };
    }
    if (!decoded.workspace) {
      return { isValid: false, errorType: 'token_invalid' };
    }
    return { isValid: true };
  } catch (error) {
    return { isValid: false, errorType: 'token_invalid' };
  }
}

/**
 * Validates if a string is a valid test person identifier
 * @param testperson The test person identifier to validate
 * @returns True if the test person identifier is valid, false otherwise
 */
export function isTestperson(testperson: string): boolean {
  if (testperson.split('@').length !== 3) return false;
  const reg = /^.+(@.+){2}$/;
  return reg.test(testperson);
}
