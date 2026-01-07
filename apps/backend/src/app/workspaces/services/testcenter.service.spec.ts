import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { JwtService } from '@nestjs/jwt';
import { HttpService } from '@nestjs/axios';
import { TestcenterService } from './testcenter.service';
import { UsersService } from '../../users/services/users.service';

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
        }
      ]
    }).compile();

    service = module.get<TestcenterService>(TestcenterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
