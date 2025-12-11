/**
 * Utility functions for generating Replay URLs
 * Centralized to ensure consistent URL format across the application
 */

export interface ReplayUrlParams {
  serverUrl: string;
  loginName: string;
  loginCode: string;
  loginGroup: string;
  bookletId: string;
  unitId: string;
  variablePage: string;
  variableAnchor: string;
  authToken: string;
}

/**
 * Generates a replay URL with proper encoding
 * URL Format: {serverUrl}/#/replay/{loginName}@{loginCode}@{loginGroup}@{bookletId}/{unitId}/{variablePage}/{variableAnchor}?auth={authToken}
 *
 * @param params - The parameters needed to build the replay URL
 * @returns The complete replay URL or empty string if required params are missing
 */
export function generateReplayUrl(params: ReplayUrlParams): string {
  const {
    serverUrl,
    loginName,
    loginCode,
    loginGroup,
    bookletId,
    unitId,
    variablePage,
    variableAnchor,
    authToken
  } = params;

  const encodedLoginName = encodeURIComponent(loginName);
  const encodedLoginCode = encodeURIComponent(loginCode);
  const encodedLoginGroup = encodeURIComponent(loginGroup || '');
  const encodedBookletId = encodeURIComponent(bookletId);
  const encodedUnitId = encodeURIComponent(unitId);
  const encodedVariablePage = encodeURIComponent(variablePage || '0');
  const encodedVariableAnchor = encodeURIComponent(variableAnchor);
  const encodedAuthToken = encodeURIComponent(authToken || '');

  return `${serverUrl}/#/replay/${encodedLoginName}@${encodedLoginCode}@${encodedLoginGroup}@${encodedBookletId}/${encodedUnitId}/${encodedVariablePage}/${encodedVariableAnchor}?auth=${encodedAuthToken}`;
}

/**
 * Generates a replay URL from a Request object (extracts serverUrl from request)
 *
 * @param req - Express Request object
 * @param params - The parameters needed to build the replay URL (without serverUrl)
 * @returns The complete replay URL
 */
export function generateReplayUrlFromRequest(
  req: { protocol: string; get: (name: string) => string | undefined },
  params: Omit<ReplayUrlParams, 'serverUrl'>
): string {
  const serverUrl = `${req.protocol}://${req.get('host')}`;
  return generateReplayUrl({ ...params, serverUrl });
}
