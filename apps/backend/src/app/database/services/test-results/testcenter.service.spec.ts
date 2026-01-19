import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { HttpService } from '@nestjs/axios';
import { TestcenterService } from './testcenter.service';
import { PersonService } from './person.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';

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
          provide: PersonService,
          useValue: createMock<PersonService>()
        },
        {
          provide: WorkspaceFilesService,
          useValue: createMock<WorkspaceFilesService>()
        }
      ]
    }).compile();

    service = module.get<TestcenterService>(TestcenterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
