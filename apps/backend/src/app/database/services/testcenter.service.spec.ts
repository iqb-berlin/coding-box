import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { JwtService } from '@nestjs/jwt';
import { TestcenterService } from './testcenter.service';
import { UsersService } from './users.service';
import { HttpModule, HttpService } from '@nestjs/axios';
import { HttpClientModule } from '@angular/common/http';
import { AuthService } from '../../auth/service/auth.service';
import { WorkspaceService } from './workspace.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import Responses from '../entities/responses.entity';
import { Repository } from 'typeorm';

describe('TestcenterService', () => {
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
        },
      ]
    }).compile();

    service = module.get<TestcenterService>(TestcenterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
