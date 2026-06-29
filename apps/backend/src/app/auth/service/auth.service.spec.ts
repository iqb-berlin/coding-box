import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { JwtService } from '@nestjs/jwt';
import { HttpService } from '@nestjs/axios';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../../database/services/users';
import {
  WORKSPACE_API_TOKEN_TYPE,
  WORKSPACE_TOKEN_SCOPE_REPLAY_READ,
  WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE
} from '../workspace-token';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: HttpService,
          useValue: createMock<HttpService>()
        },
        {
          provide: UsersService,
          useValue: createMock<UsersService>()
        },
        {
          provide: JwtService,
          useValue: createMock<JwtService>()
        }
      ]
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createToken', () => {
    beforeEach(() => {
      usersService.findUserByIdentity.mockResolvedValue({
        id: 5,
        username: 'study-manager',
        isAdmin: false
      });
      jwtService.sign.mockReturnValue('signed-token');
    });

    it('creates a workspace token for the requester identity', async () => {
      await expect(service.createToken(
        'identity-1',
        7,
        1,
        [WORKSPACE_TOKEN_SCOPE_REPLAY_READ],
        5
      )).resolves.toBe('"signed-token"');

      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          userId: 5,
          username: 'study-manager',
          sub: {
            id: 5,
            username: 'study-manager',
            isAdmin: false
          },
          workspace: 7,
          tokenType: WORKSPACE_API_TOKEN_TYPE,
          scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_READ]
        },
        { expiresIn: '1d' }
      );
      expect(usersService.getUserIsAdmin).not.toHaveBeenCalled();
      expect(usersService.getUserAccessLevel).not.toHaveBeenCalled();
    });

    it('rejects token creation for another identity without workspace admin access', async () => {
      usersService.getUserIsAdmin.mockResolvedValue(false);
      usersService.getUserAccessLevel.mockResolvedValue(2);

      await expect(service.createToken(
        'identity-1',
        7,
        1,
        [WORKSPACE_TOKEN_SCOPE_REPLAY_READ],
        12
      )).rejects.toThrow(ForbiddenException);

      expect(usersService.getUserAccessLevel).toHaveBeenCalledWith(12, 7);
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('allows system admins to create a token for another identity', async () => {
      usersService.getUserIsAdmin.mockResolvedValue(true);
      usersService.getUserAccessLevel.mockResolvedValue(null);

      await expect(service.createToken(
        'identity-1',
        7,
        1,
        [WORKSPACE_TOKEN_SCOPE_REPLAY_READ],
        12
      )).resolves.toBe('"signed-token"');

      expect(usersService.getUserIsAdmin).toHaveBeenCalledWith(12);
      expect(usersService.getUserAccessLevel).toHaveBeenCalledWith(12, 7);
      expect(jwtService.sign).toHaveBeenCalled();
    });

    it('allows workspace admins to create a token for another identity', async () => {
      usersService.getUserIsAdmin.mockResolvedValue(false);
      usersService.getUserAccessLevel.mockResolvedValue(3);

      await expect(service.createToken(
        'identity-1',
        7,
        1,
        [WORKSPACE_TOKEN_SCOPE_REPLAY_READ],
        12
      )).resolves.toBe('"signed-token"');

      expect(usersService.getUserIsAdmin).toHaveBeenCalledWith(12);
      expect(usersService.getUserAccessLevel).toHaveBeenCalledWith(12, 7);
      expect(jwtService.sign).toHaveBeenCalled();
    });

    it('rejects token creation for an unknown identity', async () => {
      usersService.findUserByIdentity.mockResolvedValue(null);

      await expect(service.createToken(
        'unknown',
        7,
        1,
        [WORKSPACE_TOKEN_SCOPE_REPLAY_READ],
        5
      )).rejects.toThrow(NotFoundException);

      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('rejects workspace tokens with too long duration', async () => {
      await expect(service.createToken(
        'identity-1',
        7,
        2,
        [WORKSPACE_TOKEN_SCOPE_REPLAY_READ],
        5
      )).rejects.toThrow(BadRequestException);

      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('rejects workspace tokens without explicit scopes', async () => {
      await expect(service.createToken('identity-1', 7, 1, [], 5)).rejects.toThrow(BadRequestException);

      expect(jwtService.sign).not.toHaveBeenCalled();
    });
  });

  describe('createTokenForUserId', () => {
    beforeEach(() => {
      usersService.findUserById.mockResolvedValue({
        id: 12,
        username: 'coder',
        isAdmin: false
      });
      jwtService.sign.mockReturnValue('signed-token');
    });

    it('creates a workspace token for the authenticated user id', async () => {
      await expect(service.createTokenForUserId(
        12,
        7,
        1,
        [
          WORKSPACE_TOKEN_SCOPE_REPLAY_READ,
          WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE
        ]
      )).resolves.toBe('"signed-token"');

      expect(usersService.findUserById).toHaveBeenCalledWith(12);
      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          userId: 12,
          username: 'coder',
          sub: {
            id: 12,
            username: 'coder',
            isAdmin: false
          },
          workspace: 7,
          tokenType: WORKSPACE_API_TOKEN_TYPE,
          scopes: [
            WORKSPACE_TOKEN_SCOPE_REPLAY_READ,
            WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE
          ]
        },
        { expiresIn: '1d' }
      );
    });

    it('rejects self-service token creation for an unknown user id', async () => {
      usersService.findUserById.mockResolvedValue(null);

      await expect(service.createTokenForUserId(
        12,
        7,
        1,
        [WORKSPACE_TOKEN_SCOPE_REPLAY_READ]
      )).rejects.toThrow(NotFoundException);

      expect(jwtService.sign).not.toHaveBeenCalled();
    });
  });
});
