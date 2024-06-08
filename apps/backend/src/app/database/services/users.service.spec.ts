import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createMock } from '@golevelup/ts-jest';
import { Repository } from 'typeorm';

import { UsersService } from './users.service';

import User from '../entities/user.entity';
import { HttpClientModule } from '@angular/common/http';
import { HttpService } from '@nestjs/axios';
import WorkspaceUser from '../entities/workspace_user.entity';

describe('UsersService', () => {
  let service: UsersService;

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
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
