import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { WorkspaceTokenStrategy } from './workspace-token.strategy';

describe('WorkspaceTokenStrategy', () => {
  const createStrategy = () => new WorkspaceTokenStrategy({
    get: jest.fn().mockReturnValue('jwt-secret')
  } as unknown as ConfigService);

  it('maps a valid workspace token payload to the request user', async () => {
    const strategy = createStrategy();

    await expect(strategy.validate({
      token_use: 'workspace',
      userId: 12,
      username: 'coder',
      workspace: 7
    })).resolves.toEqual({
      userId: 12,
      id: 12,
      name: 'coder',
      workspace: 7,
      tokenUse: 'workspace',
      isWorkspaceToken: true
    });
  });

  it('rejects non-workspace tokens', async () => {
    const strategy = createStrategy();

    await expect(strategy.validate({
      userId: 12,
      workspace: 7
    })).rejects.toThrow(UnauthorizedException);
  });

  it('rejects malformed workspace token payloads', async () => {
    const strategy = createStrategy();

    await expect(strategy.validate({
      token_use: 'workspace',
      userId: 'not-a-number',
      workspace: 7
    })).rejects.toThrow(UnauthorizedException);
  });
});
