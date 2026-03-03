import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createMock } from '@golevelup/ts-jest';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { UsersService } from './users.service';
import User from '../../entities/user.entity';
import WorkspaceUser from '../../entities/workspace_user.entity';

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: jest.Mocked<Repository<User>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: HttpService,
          useValue: createMock<HttpService>()
        },
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: createMock<Repository<User>>()
        },
        {
          provide: getRepositoryToken(WorkspaceUser),
          useValue: createMock<Repository<WorkspaceUser>>()
        }
      ]
    }).compile();

    service = module.get<UsersService>(UsersService);
    userRepository = module.get(getRepositoryToken(User));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should update isAdmin for existing keycloak users', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 42,
      username: 'hugo',
      identity: 'old-identity',
      issuer: 'old-issuer',
      isAdmin: false
    } as User);
    userRepository.update.mockResolvedValue({} as never);

    const userId = await service.createKeycloakUser({
      username: 'hugo',
      identity: 'new-identity',
      issuer: 'new-issuer',
      isAdmin: true
    });

    expect(userId).toBe(42);
    expect(userRepository.update).toHaveBeenCalledWith(
      { id: 42 },
      {
        identity: 'new-identity',
        issuer: 'new-issuer',
        isAdmin: true
      }
    );
  });
});
