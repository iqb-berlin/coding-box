import { HttpService } from '@nestjs/axios';
import { AxiosRequestConfig, AxiosResponse, isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { solveTestcenterChallenge } from './testcenter-challenge';
import { testcenterAuthenticationError, testcenterAuthenticationResponse } from './testcenter-auth-error';

export async function authenticateTestcenter(
  http: HttpService, baseUrl: string, credentials: { username: string; password: string }, options: AxiosRequestConfig
): Promise<Record<string, unknown>> {
  const body = { name: credentials.username, password: credentials.password };
  const requestOptions = {
    ...options, signal: options.signal || AbortSignal.timeout(options.timeout || 120000), maxRedirects: 0, maxContentLength: 64 * 1024, maxBodyLength: 64 * 1024
  };
  try {
    let response: AxiosResponse<unknown>;
    try {
      response = await firstValueFrom(http.put(`${baseUrl}/api/session/admin`, body, requestOptions));
    } catch (error) {
      // Since Testcenter 18.2 the direct endpoint explicitly refuses challenge-protected admin logins.
      // Do not retry invalid credentials, network errors, redirects or unrelated HTTP 400 responses.
      if (!isAxiosError(error) || error.response?.status !== 400 || typeof error.response.data !== 'string' ||
          !error.response.data.includes('Brute Force protection active.') || !error.response.data.includes('Challenge')) throw error;
      const challenge = await firstValueFrom(http.post(`${baseUrl}/api/session/challenge`, { loginType: 'admin', ...body }, requestOptions));
      const solution = await solveTestcenterChallenge(challenge.data);
      response = await firstValueFrom(http.put(`${baseUrl}/api/session`, solution, requestOptions));
    }
    return testcenterAuthenticationResponse(response.data, response.status);
  } catch (error) {
    throw testcenterAuthenticationError(error);
  }
}
