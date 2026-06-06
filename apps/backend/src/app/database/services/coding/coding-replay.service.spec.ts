import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CodingReplayService } from './coding-replay.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingListService } from './coding-list.service';
import { CodingReplayAnchorService } from './coding-replay-anchor.service';
import * as replayUrlUtil from '../../../utils/replay-url.util';

jest.mock('../../../utils/replay-url.util');

describe('CodingReplayService', () => {
  let service: CodingReplayService;

  const mockResponseRepository = {
    findOne: jest.fn()
  };

  const mockCodingJobUnitQueryBuilder = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn()
  };

  const mockCodingJobUnitRepository = {
    createQueryBuilder: jest.fn(() => mockCodingJobUnitQueryBuilder)
  };

  const mockCodingListService = {
    getVariablePageMap: jest.fn()
  };

  const mockReplayAnchorService = {
    getVariableAnchorMap: jest.fn(),
    getVariableAnchorMaps: jest.fn(),
    resolveVariableAnchor: jest.fn()
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
          provide: getRepositoryToken(CodingJobUnit),
          useValue: mockCodingJobUnitRepository
        },
        {
          provide: CodingListService,
          useValue: mockCodingListService
        },
        {
          provide: CodingReplayAnchorService,
          useValue: mockReplayAnchorService
        }
      ]
    }).compile();

    service = module.get<CodingReplayService>(CodingReplayService);

    jest.clearAllMocks();
    mockCodingJobUnitQueryBuilder.getOne.mockResolvedValue(null);
    mockReplayAnchorService.getVariableAnchorMap.mockResolvedValue(new Map());
    mockReplayAnchorService.getVariableAnchorMaps.mockResolvedValue(new Map());
    mockReplayAnchorService.resolveVariableAnchor.mockImplementation(
      async (_workspaceId, _unitName, _variableId, fallbackAnchor) => fallbackAnchor
    );
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
      expect(mockCodingJobUnitRepository.createQueryBuilder).not.toHaveBeenCalled();
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
      expect(mockCodingJobUnitRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should use coding job unit metadata when response metadata is incomplete', async () => {
      const mockResponse = {
        id: 1,
        variableid: 'var1',
        unit: {
          name: 'unit1',
          booklet: {
            person: {
              workspace_id: 1,
              login: 'response-user',
              code: 'response-code',
              group: 'response-group'
            },
            bookletinfo: null
          }
        }
      };
      const mockCodingJobUnit = {
        unit_name: 'unit1',
        variable_id: 'var1',
        variable_anchor: 'anchor1',
        booklet_name: 'booklet-from-job-unit',
        person_login: 'job-user',
        person_code: 'job-code',
        person_group: 'job-group'
      };

      mockResponseRepository.findOne.mockResolvedValue(mockResponse);
      mockCodingJobUnitQueryBuilder.getOne.mockResolvedValue(mockCodingJobUnit);
      mockCodingListService.getVariablePageMap.mockResolvedValue(new Map([['var1', '3']]));
      (replayUrlUtil.generateReplayUrl as jest.Mock).mockReturnValue('http://example.com/replay');

      await service.generateReplayUrlForResponse(1, 1, 'http://example.com', 'token');

      expect(mockCodingJobUnitRepository.createQueryBuilder).toHaveBeenCalledWith('codingJobUnit');
      expect(mockCodingJobUnitQueryBuilder.innerJoinAndSelect).toHaveBeenCalledWith(
        'codingJobUnit.coding_job',
        'codingJob',
        'codingJob.workspace_id = :workspaceId',
        { workspaceId: 1 }
      );
      expect(mockCodingJobUnitQueryBuilder.where).toHaveBeenCalledWith(
        'codingJobUnit.response_id = :responseId',
        { responseId: 1 }
      );
      expect(replayUrlUtil.generateReplayUrl).toHaveBeenCalledWith({
        serverUrl: 'http://example.com',
        loginName: 'response-user',
        loginCode: 'response-code',
        loginGroup: 'response-group',
        bookletId: 'booklet-from-job-unit',
        unitId: 'unit1',
        variablePage: '3',
        variableAnchor: 'anchor1',
        authToken: 'token'
      });
    });

    it('should use workspace-scoped coding job unit metadata when response has no person relation', async () => {
      const mockResponse = {
        id: 1,
        variableid: 'var1',
        unit: {
          name: 'unit1',
          booklet: {
            bookletinfo: {
              name: 'booklet1'
            }
          }
        }
      };
      const mockCodingJobUnit = {
        unit_name: 'unit1',
        variable_id: 'var1',
        variable_anchor: 'var1',
        booklet_name: 'booklet-from-job-unit',
        person_login: 'job-user',
        person_code: 'job-code',
        person_group: 'job-group'
      };

      mockResponseRepository.findOne.mockResolvedValue(mockResponse);
      mockCodingJobUnitQueryBuilder.getOne.mockResolvedValue(mockCodingJobUnit);
      mockCodingListService.getVariablePageMap.mockResolvedValue(new Map());
      (replayUrlUtil.generateReplayUrl as jest.Mock).mockReturnValue('http://example.com/replay');

      await service.generateReplayUrlForResponse(1, 1, 'http://example.com', 'token');

      expect(replayUrlUtil.generateReplayUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          loginName: 'job-user',
          loginCode: 'job-code',
          loginGroup: 'job-group',
          bookletId: 'booklet1'
        })
      );
    });

    it('should throw when neither response nor coding job unit provide enough replay metadata', async () => {
      mockResponseRepository.findOne.mockResolvedValue({
        id: 1,
        variableid: 'var1',
        unit: {
          name: 'unit1'
        }
      });
      mockCodingJobUnitQueryBuilder.getOne.mockResolvedValue(null);

      await expect(
        service.generateReplayUrlForResponse(1, 1, 'http://example.com', 'token')
      ).rejects.toThrow('Replay metadata for response 1 in workspace 1 not found');
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

    it('should generate replay URL when person code is empty', async () => {
      const mockResponse = {
        id: 1,
        variableid: 'var1',
        unit: {
          name: 'unit1',
          booklet: {
            person: {
              workspace_id: 1,
              login: 'testuser',
              code: '',
              group: 'group1'
            },
            bookletinfo: {
              name: 'booklet1'
            }
          }
        }
      };

      mockResponseRepository.findOne.mockResolvedValue(mockResponse);
      mockCodingListService.getVariablePageMap.mockResolvedValue(new Map([['var1', '2']]));
      (replayUrlUtil.generateReplayUrl as jest.Mock).mockReturnValue('http://example.com/replay');

      await service.generateReplayUrlForResponse(1, 1, 'http://example.com', 'token');

      expect(mockCodingJobUnitRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(replayUrlUtil.generateReplayUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          loginCode: ''
        })
      );
    });

    it('should keep empty response person code and group when fallback metadata is needed', async () => {
      const mockResponse = {
        id: 1,
        variableid: 'var1',
        unit: {
          name: 'unit1',
          booklet: {
            person: {
              workspace_id: 1,
              login: 'testuser',
              code: '',
              group: ''
            },
            bookletinfo: null
          }
        }
      };
      const mockCodingJobUnit = {
        unit_name: 'unit1',
        variable_id: 'var1',
        variable_anchor: 'anchor1',
        booklet_name: 'booklet-from-job-unit',
        person_login: 'job-user',
        person_code: 'stale-code',
        person_group: 'stale-group'
      };

      mockResponseRepository.findOne.mockResolvedValue(mockResponse);
      mockCodingJobUnitQueryBuilder.getOne.mockResolvedValue(mockCodingJobUnit);
      mockCodingListService.getVariablePageMap.mockResolvedValue(new Map([['var1', '2']]));
      (replayUrlUtil.generateReplayUrl as jest.Mock).mockReturnValue('http://example.com/replay');

      await service.generateReplayUrlForResponse(1, 1, 'http://example.com', 'token');

      expect(replayUrlUtil.generateReplayUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          loginName: 'testuser',
          loginCode: '',
          loginGroup: '',
          bookletId: 'booklet-from-job-unit'
        })
      );
    });

    it('should use default page 0 when variable page lookup fails', async () => {
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

      mockResponseRepository.findOne.mockResolvedValue(mockResponse);
      mockCodingListService.getVariablePageMap.mockRejectedValue(new Error('VOUD unavailable'));
      (replayUrlUtil.generateReplayUrl as jest.Mock).mockReturnValue('http://example.com/replay');

      await service.generateReplayUrlForResponse(1, 1, 'http://example.com', 'token');

      expect(replayUrlUtil.generateReplayUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          variablePage: '0'
        })
      );
    });

    it('should keep resolved single-page variables on page 0', async () => {
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

      mockResponseRepository.findOne.mockResolvedValue(mockResponse);
      mockCodingListService.getVariablePageMap.mockResolvedValue(new Map([['var1', '0']]));
      (replayUrlUtil.generateReplayUrl as jest.Mock).mockReturnValue('http://example.com/replay');

      await service.generateReplayUrlForResponse(1, 1, 'http://example.com', 'token');

      expect(replayUrlUtil.generateReplayUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          variablePage: '0',
          variableAnchor: 'var1'
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

  describe('generateReplayUrlsForItemsBulk', () => {
    it('should use variable anchor when generating replay URLs', async () => {
      const items = [
        {
          responseId: 1,
          unitName: 'unit1',
          unitAlias: null,
          variableId: 'var1',
          variableAnchor: 'anchor1',
          bookletName: 'booklet1',
          personLogin: 'user1',
          personCode: 'code1',
          personGroup: 'group1'
        }
      ];

      mockCodingListService.getVariablePageMap.mockResolvedValue(new Map([['var1', '4']]));
      (replayUrlUtil.generateReplayUrl as jest.Mock).mockReturnValue('http://example.com/replay?auth=');

      const result = await service.generateReplayUrlsForItemsBulk(
        1,
        items,
        'http://example.com'
      );

      expect(result[0].replayUrl).toBe('http://example.com/replay');
      expect(replayUrlUtil.generateReplayUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          variablePage: '4',
          variableAnchor: 'anchor1'
        })
      );
    });

    it('should use resolved page overrides for coding job replay URLs', async () => {
      const items = [
        {
          responseId: 1,
          unitName: 'UNIT',
          unitAlias: null,
          variableId: 'VAR_WITH_OVERRIDE',
          variableAnchor: 'VAR_WITH_OVERRIDE',
          bookletName: 'BOOKLET',
          personLogin: 'login',
          personCode: 'code',
          personGroup: 'group'
        }
      ];

      mockCodingListService.getVariablePageMap.mockResolvedValue(new Map([
        ['VAR_WITH_OVERRIDE', '1']
      ]));
      (replayUrlUtil.generateReplayUrl as jest.Mock).mockImplementation(params => (
        `${params.serverUrl}/#/replay/${params.loginName}@${params.loginCode}@${params.loginGroup}@${params.bookletId}/${params.unitId}/${params.variablePage}/${params.variableAnchor}?auth=${params.authToken}`
      ));

      const result = await service.generateReplayUrlsForItemsBulk(
        7,
        items,
        'http://example.com'
      );

      expect(mockCodingListService.getVariablePageMap).toHaveBeenCalledWith('UNIT', 7);
      expect(result[0].replayUrl).toBe(
        'http://example.com/#/replay/login@code@group@BOOKLET/UNIT/1/VAR_WITH_OVERRIDE'
      );
    });

    it('should use replay anchor overrides for coding job replay URLs', async () => {
      const items = [
        {
          responseId: 1,
          unitName: 'UNIT',
          unitAlias: null,
          variableId: 'VAR',
          variableAnchor: 'VAR',
          bookletName: 'BOOKLET',
          personLogin: 'login',
          personCode: 'code',
          personGroup: 'group'
        }
      ];

      mockCodingListService.getVariablePageMap.mockResolvedValue(new Map([
        ['VAR', '0']
      ]));
      mockReplayAnchorService.getVariableAnchorMaps.mockResolvedValue(new Map([
        ['UNIT', new Map([['VAR', 'TEXT_ANCHOR']])]
      ]));
      (replayUrlUtil.generateReplayUrl as jest.Mock).mockImplementation(params => (
        `${params.serverUrl}/#/replay/${params.loginName}@${params.loginCode}@${params.loginGroup}@${params.bookletId}/${params.unitId}/${params.variablePage}/${params.variableAnchor}?auth=${params.authToken}`
      ));

      const result = await service.generateReplayUrlsForItemsBulk(
        7,
        items,
        'http://example.com'
      );

      expect(mockReplayAnchorService.getVariableAnchorMaps).toHaveBeenCalledWith(['UNIT'], 7);
      expect(result[0].replayUrl).toBe(
        'http://example.com/#/replay/login@code@group@BOOKLET/UNIT/0/TEXT_ANCHOR'
      );
    });
  });
});
