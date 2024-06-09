import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { createMock } from '@golevelup/ts-jest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import User from '../entities/user.entity';
import { WorkspaceService } from './workspace.service';
import FileUpload from '../entities/file_upload.entity';

describe('WorkspaceService', () => {
  let service: WorkspaceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: HttpService,
          useValue: createMock<HttpService>()
        },
        {
          provide: WorkspaceService,
          useValue: createMock<WorkspaceService>()
        },
        {
          provide: getRepositoryToken(FileUpload),
          useValue: createMock<Repository<FileUpload>>()
        },
        {
          provide: getRepositoryToken(User),
          useValue: createMock<Repository<User>>()
        }

      ]
    }).compile();

    service = module.get<WorkspaceService>(WorkspaceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
