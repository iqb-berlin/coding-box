import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CodingReplayService } from './coding-replay.service';
import { ResponseEntity } from '../entities/response.entity';
import { CodingListService } from './coding-list.service';
import * as replayUrlUtil from '../../utils/replay-url.util';

jest.mock('../../utils/replay-url.util');

describe('CodingReplayService', () => {
  let service: CodingReplayService;

  const mockResponseRepository = {
    findOne: jest.fn()
  };

  const mockCodingListService = {
    getVariablePageMap: jest.fn()
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodingReplayService,
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: mockResponseRepository
        },
        {
          provide: CodingListService,
          useValue: mockCodingListService
        }
      ]
    }).compile();

    service = module.get<CodingReplayService>(CodingReplayService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateReplayUrlForResponse', () => {
    it('should generate replay URL successfully', async () => {
      const mockResponse = {
        id: 1,
        variableid: 'var1',
        unit: {
          name: 'unit1',
          booklet: {
            person: {
              workspace_id: 1,
              login: 'testuser',
              code: 'code123',
              group: 'group1'
            },
            bookletinfo: {
              name: 'booklet1'
            }
          }
        }
      };

      const mockVariablePageMap = new Map([['var1', '2']]);
      const mockReplayUrl = 'http://example.com/replay?auth=token123';

      mockResponseRepository.findOne.mockResolvedValue(mockResponse);
      mockCodingListService.getVariablePageMap.mockResolvedValue(mockVariablePageMap);
      (replayUrlUtil.generateReplayUrl as jest.Mock).mockReturnValue(mockReplayUrl);

      const result = await service.generateReplayUrlForResponse(
        1,
        1,
        'http://example.com',
        'token123'
      );

      expect(result).toEqual({ replayUrl: mockReplayUrl });
      expect(mockResponseRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: [
          'unit',
          'unit.booklet',
          'unit.booklet.person',
          'unit.booklet.bookletinfo'
        ]
      });
      expect(mockCodingListService.getVariablePageMap).toHaveBeenCalledWith('unit1', 1);
      expect(replayUrlUtil.generateReplayUrl).toHaveBeenCalledWith({
        serverUrl: 'http://example.com',
        loginName: 'testuser',
        loginCode: 'code123',
        loginGroup: 'group1',
        bookletId: 'booklet1',
        unitId: 'unit1',
        variablePage: '2',
        variableAnchor: 'var1',
        authToken: 'token123'
      });
    });

    it('should throw error when response not found', async () => {
      mockResponseRepository.findOne.mockResolvedValue(null);

      await expect(
        service.generateReplayUrlForResponse(1, 999, 'http://example.com', 'token')
      ).rejects.toThrow('Response with id 999 not found');
    });

    it('should throw error when response belongs to different workspace', async () => {
      const mockResponse = {
        id: 1,
        unit: {
          booklet: {
            person: {
              workspace_id: 2
            }
          }
        }
      };

      mockResponseRepository.findOne.mockResolvedValue(mockResponse);

      await expect(
        service.generateReplayUrlForResponse(1, 1, 'http://example.com', 'token')
      ).rejects.toThrow('Response 1 does not belong to workspace 1');
    });

    it('should use default page 0 when variable not found in map', async () => {
      const mockResponse = {
        id: 1,
        variableid: 'var1',
        unit: {
          name: 'unit1',
          booklet: {
            person: {
              workspace_id: 1,
              login: 'testuser',
              code: 'code123',
              group: 'group1'
            },
            bookletinfo: {
              name: 'booklet1'
            }
          }
        }
      };

      const mockVariablePageMap = new Map();
      const mockReplayUrl = 'http://example.com/replay';

      mockResponseRepository.findOne.mockResolvedValue(mockResponse);
      mockCodingListService.getVariablePageMap.mockResolvedValue(mockVariablePageMap);
      (replayUrlUtil.generateReplayUrl as jest.Mock).mockReturnValue(mockReplayUrl);

      await service.generateReplayUrlForResponse(1, 1, 'http://example.com', 'token');

      expect(replayUrlUtil.generateReplayUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          variablePage: '0'
        })
      );
    });
  });

  describe('generateReplayUrlsForItems', () => {
    it('should generate replay URLs for multiple items', async () => {
      const items = [
        {
          responseId: 1,
          unitName: 'unit1',
          unitAlias: null,
          variableId: 'var1',
          variableAnchor: 'var1',
          bookletName: 'booklet1',
          personLogin: 'user1',
          personCode: 'code1',
          personGroup: 'group1'
        },
        {
          responseId: 2,
          unitName: 'unit2',
          unitAlias: 'alias2',
          variableId: 'var2',
          variableAnchor: 'var2',
          bookletName: 'booklet2',
          personLogin: 'user2',
          personCode: 'code2',
          personGroup: 'group2'
        }
      ];

      const mockResponse1 = {
        id: 1,
        variableid: 'var1',
        unit: {
          name: 'unit1',
          booklet: {
            person: {
              workspace_id: 1, login: 'user1', code: 'code1', group: 'group1'
            },
            bookletinfo: { name: 'booklet1' }
          }
        }
      };

      const mockResponse2 = {
        id: 2,
        variableid: 'var2',
        unit: {
          name: 'unit2',
          booklet: {
            person: {
              workspace_id: 1, login: 'user2', code: 'code2', group: 'group2'
            },
            bookletinfo: { name: 'booklet2' }
          }
        }
      };

      mockResponseRepository.findOne
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2);
      mockCodingListService.getVariablePageMap.mockResolvedValue(new Map());
      (replayUrlUtil.generateReplayUrl as jest.Mock)
        .mockReturnValueOnce('http://example.com/replay1?auth=')
        .mockReturnValueOnce('http://example.com/replay2?auth=');

      const result = await service.generateReplayUrlsForItems(
        1,
        items,
        'http://example.com'
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        responseId: 1,
        replayUrl: 'http://example.com/replay1'
      });
      expect(result[1]).toMatchObject({
        responseId: 2,
        replayUrl: 'http://example.com/replay2'
      });
    });

    it('should handle errors gracefully and return empty URL', async () => {
      const items = [
        {
          responseId: 999,
          unitName: 'unit1',
          unitAlias: null,
          variableId: 'var1',
          variableAnchor: 'var1',
          bookletName: 'booklet1',
          personLogin: 'user1',
          personCode: 'code1',
          personGroup: 'group1'
        }
      ];

      mockResponseRepository.findOne.mockResolvedValue(null);

      const result = await service.generateReplayUrlsForItems(
        1,
        items,
        'http://example.com'
      );

      expect(result).toHaveLength(1);
      expect(result[0].replayUrl).toBe('');
    });
  });
});
