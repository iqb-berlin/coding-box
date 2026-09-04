import { firstValueFrom, of } from 'rxjs';
import { AppService, AuthDataRefreshOutcome } from '../services/app.service';
import {
  MutationAuthDataRefreshResult,
  hasCurrentAuthDataAfterMutation,
  runMutationAndRefreshAuthData
} from './auth-data-refresh';

describe('auth data refresh after mutation', () => {
  const createAppService = (outcome: AuthDataRefreshOutcome) => ({
    refreshAuthData: jest.fn().mockReturnValue(of(outcome))
  }) as unknown as AppService;

  it('should skip the refresh when the mutation failed', async () => {
    const appService = createAppService('updated');

    const result = await firstValueFrom(runMutationAndRefreshAuthData(appService, of(false)));

    expect(result).toEqual({
      mutationSucceeded: false,
      authDataRefreshOutcome: 'not-requested'
    });
    expect(appService.refreshAuthData).not.toHaveBeenCalled();
  });

  it.each<AuthDataRefreshOutcome>([
    'updated',
    'superseded',
    'failed',
    'invalidated'
  ])('should preserve the %s refresh outcome after a successful mutation', async outcome => {
    const appService = createAppService(outcome);

    const result = await firstValueFrom(runMutationAndRefreshAuthData(appService, of(true)));

    expect(result).toEqual({
      mutationSucceeded: true,
      authDataRefreshOutcome: outcome
    });
  });

  it.each<{
    result: MutationAuthDataRefreshResult;
    expected: boolean;
  }>([
    {
      result: { mutationSucceeded: true, authDataRefreshOutcome: 'updated' },
      expected: true
    },
    {
      result: { mutationSucceeded: true, authDataRefreshOutcome: 'superseded' },
      expected: true
    },
    {
      result: { mutationSucceeded: true, authDataRefreshOutcome: 'failed' },
      expected: false
    },
    {
      result: { mutationSucceeded: true, authDataRefreshOutcome: 'invalidated' },
      expected: false
    },
    {
      result: { mutationSucceeded: false, authDataRefreshOutcome: 'not-requested' },
      expected: false
    }
  ])('should report whether auth data is current', ({ result, expected }) => {
    expect(hasCurrentAuthDataAfterMutation(result)).toBe(expected);
  });
});
