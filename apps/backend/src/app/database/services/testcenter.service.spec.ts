import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { JwtService } from '@nestjs/jwt';
import { HttpService } from '@nestjs/axios';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestcenterService } from './testcenter.service';
import { UsersService } from './users.service';
import { WorkspaceService } from './workspace.service';
import Responses from '../entities/responses.entity';

describe('TestCenterService', () => {
  let service: TestcenterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestcenterService,
        {
          provide: HttpService,
          useValue: createMock<HttpService>()
        },
        {
          provide: WorkspaceService,
          useValue: createMock<WorkspaceService>()
        },
        {
          provide: TestcenterService,
          useValue: createMock<TestcenterService>()
        },
        {
          provide: UsersService,
          useValue: createMock<UsersService>()
        },
        {
          provide: JwtService,
          useValue: createMock<JwtService>()
        },
        {
          provide: getRepositoryToken(Responses),
          useValue: createMock<Repository<Responses>>()
        }
      ]
    }).compile();

    service = module.get<TestcenterService>(TestcenterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
