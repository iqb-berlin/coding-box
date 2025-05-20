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

  describe('cleanResponses', () => {
    it('should remove duplicate responses based on test_person and unit_id', () => {
      const input = [
        {
          id: 1,
          test_person: 'person1',
          unit_id: 'unit1',
          test_group: 'group1',
          workspace_id: 1,
          created_at: new Date(),
          responses: [{
            id: 'response1',
            content: 'data1',
            ts: 123,
            responseType: 'type1'
          }],
          booklet_id: 'booklet1',
          unit_state: { status: 'incomplete' }
        },
        {
          id: 2,
          test_person: 'person1',
          unit_id: 'unit1',
          test_group: 'group1',
          workspace_id: 1,
          created_at: new Date(),
          responses: [],
          booklet_id: 'booklet1'
        }
      ];

      const result = WorkspaceService.cleanResponses(input);

      expect(result)
        .toHaveLength(1);
      expect(result[0].responses)
        .toEqual([{
          id: 'response1',
          content: 'data1',
          ts: 123,
          responseType: 'type1'
        }]);
      expect(result[0].unit_state)
        .toEqual({ status: 'incomplete' });
    });

    it('should retain the response with non-empty responses and unit_state', () => {
      const input = [
        {
          id: 1,
          test_person: 'person1',
          unit_id: 'unit1',
          test_group: 'group1',
          workspace_id: 1,
          created_at: new Date(),
          responses: [],
          booklet_id: 'booklet1',
          unit_state: {}
        },
        {
          id: 2,
          test_person: 'person1',
          unit_id: 'unit1',
          test_group: 'group1',
          workspace_id: 1,
          created_at: new Date(),
          responses: [{
            id: 'response2',
            content: 'data2',
            ts: 456,
            responseType: 'type2'
          }],
          booklet_id: 'booklet1',
          unit_state: { status: 'complete' }
        }
      ];

      const result = WorkspaceService.cleanResponses(input);

      expect(result)
        .toHaveLength(1);
      expect(result[0].responses)
        .toEqual([{
          id: 'response2',
          content: 'data2',
          ts: 456,
          responseType: 'type2'
        }]);
      expect(result[0].unit_state)
        .toEqual({ status: 'complete' });
    });

    it('should return an empty array when given an empty input', () => {
      const result = WorkspaceService.cleanResponses([]);

      expect(result)
        .toEqual([]);
    });
  });
});
