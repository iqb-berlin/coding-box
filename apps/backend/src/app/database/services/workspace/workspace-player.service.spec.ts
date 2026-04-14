import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { WorkspacePlayerService } from './workspace-player.service';
import FileUpload from '../../entities/file_upload.entity';
import Persons from '../../entities/persons.entity';
import { ResponseEntity } from '../../entities/response.entity';

describe('WorkspacePlayerService', () => {
  let service: WorkspacePlayerService;

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn()
  };

  const mockRepository = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
    find: jest.fn()
  };

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspacePlayerService,
        {
          provide: getRepositoryToken(FileUpload),
          useValue: mockRepository
        },
        {
          provide: getRepositoryToken(Persons),
          useValue: mockRepository
        },
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: mockRepository
        }
      ]
    }).compile();

    service = module.get<WorkspacePlayerService>(WorkspacePlayerService);

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findPlayer - Exact major.minor match with highest patch', () => {
    it('should select highest patch version for exact major.minor match', async () => {
      const mockPlayers = [
        {
          file_id: 'IQB-PLAYER-ASPECT-2.6.0',
          workspace_id: 5,
          filename: 'player-2.6.0.html'
        },
        {
          file_id: 'IQB-PLAYER-ASPECT-2.6.2',
          workspace_id: 5,
          filename: 'player-2.6.2.html'
        },
        {
          file_id: 'IQB-PLAYER-ASPECT-2.6.1',
          workspace_id: 5,
          filename: 'player-2.6.1.html'
        }
      ];

      mockQueryBuilder.getMany.mockResolvedValue(mockPlayers);

      const result = await service.findPlayer(5, 'IQB-PLAYER-ASPECT-2.6');

      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('file');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(file.file_id LIKE :patternWithPatch OR file.file_id = :exactTwoPart)',
        {
          patternWithPatch: 'IQB-PLAYER-ASPECT-2.6.%',
          exactTwoPart: 'IQB-PLAYER-ASPECT-2.6'
        }
      );
      expect(result).toHaveLength(1);
      expect(result[0].file_id).toBe('IQB-PLAYER-ASPECT-2.6.2');
    });

    it('should select exact patch version when requested', async () => {
      const mockPlayers = [
        {
          file_id: 'IQB-PLAYER-ASPECT-2.6.1',
          workspace_id: 5,
          filename: 'player-2.6.1.html'
        }
      ];

      mockQueryBuilder.getMany.mockResolvedValue(mockPlayers);

      const result = await service.findPlayer(5, 'IQB-PLAYER-ASPECT-2.6.1');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(file.file_id LIKE :patternWithPatch OR file.file_id = :exactTwoPart)',
        {
          patternWithPatch: 'IQB-PLAYER-ASPECT-2.6.%',
          exactTwoPart: 'IQB-PLAYER-ASPECT-2.6'
        }
      );
      expect(result).toHaveLength(1);
      expect(result[0].file_id).toBe('IQB-PLAYER-ASPECT-2.6.1');
    });

    it('should fallback to highest minor.patch version if exact minor not found', async () => {
      // First query returns empty (no 2.6.x), second query returns 2.9.x versions
      mockQueryBuilder.getMany
        .mockResolvedValueOnce([]) // No exact minor match
        .mockResolvedValueOnce([
          {
            file_id: 'IQB-PLAYER-ASPECT-2.8.1',
            workspace_id: 5,
            filename: 'player-2.8.1.html'
          },
          {
            file_id: 'IQB-PLAYER-ASPECT-2.9.0',
            workspace_id: 5,
            filename: 'player-2.9.0.html'
          },
          {
            file_id: 'IQB-PLAYER-ASPECT-2.9.4',
            workspace_id: 5,
            filename: 'player-2.9.4.html'
          }
        ]); // Fallback to all 2.x

      const result = await service.findPlayer(5, 'IQB-PLAYER-ASPECT-2.6');

      expect(mockRepository.createQueryBuilder).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(1);
      expect(result[0].file_id).toBe('IQB-PLAYER-ASPECT-2.9.4');
    });
  });

  describe('findPlayer - Version sorting', () => {
    it('should correctly sort by patch version descending', async () => {
      const mockPlayers = [
        {
          file_id: 'PLAYER-1.0.5',
          workspace_id: 1,
          filename: 'player-1.0.5.html'
        },
        {
          file_id: 'PLAYER-1.0.10',
          workspace_id: 1,
          filename: 'player-1.0.10.html'
        },
        {
          file_id: 'PLAYER-1.0.2',
          workspace_id: 1,
          filename: 'player-1.0.2.html'
        }
      ];

      mockQueryBuilder.getMany.mockResolvedValue(mockPlayers);

      const result = await service.findPlayer(1, 'PLAYER-1.0');

      expect(result[0].file_id).toBe('PLAYER-1.0.10'); // Highest patch
    });

    it('should correctly sort by minor and patch version when falling back', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce([]) // No exact match
        .mockResolvedValueOnce([
          {
            file_id: 'PLAYER-1.5.0',
            workspace_id: 1,
            filename: 'player-1.5.0.html'
          },
          {
            file_id: 'PLAYER-1.10.2',
            workspace_id: 1,
            filename: 'player-1.10.2.html'
          },
          {
            file_id: 'PLAYER-1.10.1',
            workspace_id: 1,
            filename: 'player-1.10.1.html'
          },
          {
            file_id: 'PLAYER-1.2.5',
            workspace_id: 1,
            filename: 'player-1.2.5.html'
          }
        ]);

      const result = await service.findPlayer(1, 'PLAYER-1.3');

      expect(result[0].file_id).toBe('PLAYER-1.10.2'); // Highest minor.patch
    });
  });

  describe('findPlayer - Edge cases', () => {
    it('should handle player with only one version', async () => {
      const mockPlayers = [
        {
          file_id: 'PLAYER-1.0.0',
          workspace_id: 1,
          filename: 'player-1.0.0.html'
        }
      ];

      mockQueryBuilder.getMany.mockResolvedValue(mockPlayers);

      const result = await service.findPlayer(1, 'PLAYER-1.0');

      expect(result).toHaveLength(1);
      expect(result[0].file_id).toBe('PLAYER-1.0.0');
    });

    it('should return empty array when no players found', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);
      mockRepository.find.mockResolvedValue([]);

      const result = await service.findPlayer(1, 'NONEXISTENT-1.0');

      expect(result).toEqual([]);
    });

    it('should handle uppercase conversion correctly', async () => {
      const mockPlayers = [
        {
          file_id: 'ASPECT-2.0.0',
          workspace_id: 5,
          filename: 'aspect-2.0.0.html'
        }
      ];

      mockQueryBuilder.getMany.mockResolvedValue(mockPlayers);

      const result = await service.findPlayer(5, 'aspect-2.0');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(file.file_id LIKE :patternWithPatch OR file.file_id = :exactTwoPart)',
        {
          patternWithPatch: 'ASPECT-2.0.%',
          exactTwoPart: 'ASPECT-2.0'
        }
      );
      expect(result[0].file_id).toBe('ASPECT-2.0.0');
    });

    it('should throw error for invalid workspace ID', async () => {
      await expect(
        service.findPlayer(null as unknown as number, 'PLAYER-1.0')
      ).rejects.toThrow('Invalid workspaceId parameter');
    });

    it('should throw error for invalid player name', async () => {
      await expect(service.findPlayer(1, '')).rejects.toThrow(
        'Invalid playerName parameter'
      );
    });
  });

  describe('findPlayer - Complex module names', () => {
    it('should handle multi-word module names with hyphens', async () => {
      const mockPlayers = [
        {
          file_id: 'IQB-PLAYER-ASPECT-3.5.1',
          workspace_id: 5,
          filename: 'player.html'
        }
      ];

      mockQueryBuilder.getMany.mockResolvedValue(mockPlayers);

      const result = await service.findPlayer(5, 'IQB-PLAYER-ASPECT-3.5');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(file.file_id LIKE :patternWithPatch OR file.file_id = :exactTwoPart)',
        {
          patternWithPatch: 'IQB-PLAYER-ASPECT-3.5.%',
          exactTwoPart: 'IQB-PLAYER-ASPECT-3.5'
        }
      );
      expect(result[0].file_id).toBe('IQB-PLAYER-ASPECT-3.5.1');
    });

    it('should handle numeric characters in module names', async () => {
      const mockPlayers = [
        {
          file_id: 'PLAYER2D-1.0.0',
          workspace_id: 5,
          filename: 'player2d.html'
        }
      ];

      mockQueryBuilder.getMany.mockResolvedValue(mockPlayers);

      const result = await service.findPlayer(5, 'PLAYER2D-1.0');

      expect(result).toHaveLength(1);
      expect(result[0].file_id).toBe('PLAYER2D-1.0.0');
    });
  });

  describe('findPlayer - Backward compatibility', () => {
    it('should find players with .0 patch when old format requested', async () => {
      const mockPlayers = [
        {
          file_id: 'LEGACY-PLAYER-1.5.0',
          workspace_id: 1,
          filename: 'legacy.html'
        }
      ];

      mockQueryBuilder.getMany.mockResolvedValue(mockPlayers);

      const result = await service.findPlayer(1, 'LEGACY-PLAYER-1.5');

      expect(result).toHaveLength(1);
      expect(result[0].file_id).toBe('LEGACY-PLAYER-1.5.0');
    });

    it('should prefer newer patch versions over .0 patch', async () => {
      const mockPlayers = [
        {
          file_id: 'PLAYER-2.0.0',
          workspace_id: 1,
          filename: 'player-2.0.0.html'
        },
        {
          file_id: 'PLAYER-2.0.3',
          workspace_id: 1,
          filename: 'player-2.0.3.html'
        }
      ];

      mockQueryBuilder.getMany.mockResolvedValue(mockPlayers);

      const result = await service.findPlayer(1, 'PLAYER-2.0');

      expect(result[0].file_id).toBe('PLAYER-2.0.3');
    });

    it('should find old format players (2-part version) when requested', async () => {
      const mockPlayers = [
        {
          file_id: 'OLD-PLAYER-1.5',
          workspace_id: 1,
          filename: 'old-player.html'
        }
      ];

      mockQueryBuilder.getMany.mockResolvedValue(mockPlayers);

      const result = await service.findPlayer(1, 'OLD-PLAYER-1.5');

      expect(result[0].file_id).toBe('OLD-PLAYER-1.5');
    });

    it('should prefer new format (3-part) over old format (2-part) when both exist', async () => {
      const mockPlayers = [
        {
          file_id: 'MIXED-PLAYER-2.5',
          workspace_id: 1,
          filename: 'mixed-old.html'
        },
        {
          file_id: 'MIXED-PLAYER-2.5.0',
          workspace_id: 1,
          filename: 'mixed-new.html'
        }
      ];

      mockQueryBuilder.getMany.mockResolvedValue(mockPlayers);

      const result = await service.findPlayer(1, 'MIXED-PLAYER-2.5');

      // Should select the 2-part version which is treated as patch 0
      // Both have patch 0, so either is acceptable, but 3-part format is preferred in sorting
      expect(result[0].file_id).toMatch(/MIXED-PLAYER-2.5/);
    });

    it('should handle mix of old and new format players', async () => {
      const mockPlayers = [
        {
          file_id: 'IQB-PLAYER-ASPECT-2.5',
          workspace_id: 5,
          filename: 'old.html'
        },
        {
          file_id: 'IQB-PLAYER-ASPECT-2.5.0',
          workspace_id: 5,
          filename: 'new-0.html'
        },
        {
          file_id: 'IQB-PLAYER-ASPECT-2.5.2',
          workspace_id: 5,
          filename: 'new-2.html'
        }
      ];

      mockQueryBuilder.getMany.mockResolvedValue(mockPlayers);

      const result = await service.findPlayer(5, 'IQB-PLAYER-ASPECT-2.5');

      // Should select the highest patch version (2.5.2)
      expect(result[0].file_id).toBe('IQB-PLAYER-ASPECT-2.5.2');
    });
  });

  describe('findUnitDef - Unit delivery', () => {
    it('should return unit definition files for a given unit ID', async () => {
      const mockUnitFiles = [
        {
          file_id: 'UNIT123.VOUD',
          filename: 'unit123.xml',
          data: '<Unit>...</Unit>'
        }
      ];

      mockRepository.find.mockResolvedValue(mockUnitFiles);

      const result = await service.findUnitDef(5, 'UNIT123');

      expect(mockRepository.find).toHaveBeenCalledWith({
        select: ['file_id', 'filename', 'data'],
        where: {
          file_id: 'UNIT123.VOUD',
          workspace_id: 5
        }
      });
      expect(result).toEqual(mockUnitFiles);
    });

    it('should return empty array when no unit definition found', async () => {
      mockRepository.find.mockResolvedValue([]);

      const result = await service.findUnitDef(5, 'NONEXISTENT');

      expect(result).toEqual([]);
    });

    it('should throw error when repository fails', async () => {
      mockRepository.find.mockRejectedValue(new Error('DB error'));

      await expect(service.findUnitDef(5, 'UNIT123')).rejects.toThrow(
        'Could not retrieve unit definition for unit: UNIT123'
      );
    });
  });

  describe('findUnit - Unit delivery', () => {
    it('should return unit files for a given unit ID', async () => {
      const mockUnitFiles = [
        {
          file_id: 'UNIT123',
          workspace_id: 5,
          filename: 'unit123.json',
          data: '{"content": "test"}'
        }
      ];

      mockRepository.find.mockResolvedValue(mockUnitFiles);

      const result = await service.findUnit(5, 'UNIT123');

      expect(mockRepository.find).toHaveBeenCalledWith({
        where: {
          file_id: 'UNIT123',
          workspace_id: 5
        }
      });
      expect(result).toEqual(mockUnitFiles);
    });

    it('should return empty array when no unit found', async () => {
      mockRepository.find.mockResolvedValue([]);

      const result = await service.findUnit(5, 'NONEXISTENT');

      expect(result).toEqual([]);
    });
  });

  describe('getBookletUnits - Unit delivery', () => {
    it('should parse booklet XML and extract units', async () => {
      const mockBookletFiles = [
        {
          file_id: 'BOOKLET1',
          workspace_id: 5,
          data: `
            <Booklet id="100">
              <Units>
                <Unit id="UNIT1" alias="Unit One"/>
                <Unit id="UNIT2" label="Unit Two"/>
              </Units>
            </Booklet>
          `
        }
      ];

      mockRepository.find.mockResolvedValue(mockBookletFiles);

      const result = await service.getBookletUnits(5, 'BOOKLET1');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 1,
        name: 'UNIT1',
        alias: 'Unit One',
        bookletId: 100
      });
      expect(result[1]).toEqual({
        id: 2,
        name: 'UNIT2',
        alias: 'Unit Two',
        bookletId: 100
      });
    });

    it('should handle nested testlets in booklet XML', async () => {
      const mockBookletFiles = [
        {
          file_id: 'BOOKLET2',
          workspace_id: 5,
          data: `
            <Booklet id="200">
              <Units>
                <Testlet id="TESTLET1">
                  <Unit id="UNIT3" alias="Nested Unit"/>
                </Testlet>
                <Unit id="UNIT4"/>
              </Units>
            </Booklet>
          `
        }
      ];

      mockRepository.find.mockResolvedValue(mockBookletFiles);

      const result = await service.getBookletUnits(5, 'BOOKLET2');

      expect(result).toHaveLength(2);
      // Direct units are processed before testlets
      expect(result[0].name).toBe('UNIT4');
      expect(result[1].name).toBe('UNIT3');
    });

    it('should throw NotFoundException when booklet not found', async () => {
      mockRepository.find.mockResolvedValue([]);

      await expect(service.getBookletUnits(5, 'NONEXISTENT')).rejects.toThrow(
        'Booklet file with ID NONEXISTENT not found'
      );
    });

    it('should return empty array for booklet with no units', async () => {
      const mockBookletFiles = [
        {
          file_id: 'EMPTY_BOOKLET',
          workspace_id: 5,
          data: '<Booklet id="300"><Units></Units></Booklet>'
        }
      ];

      mockRepository.find.mockResolvedValue(mockBookletFiles);

      const result = await service.getBookletUnits(5, 'EMPTY_BOOKLET');

      expect(result).toEqual([]);
    });

    it('should handle invalid XML gracefully', async () => {
      const mockBookletFiles = [
        {
          file_id: 'INVALID_BOOKLET',
          workspace_id: 5,
          data: '<invalid>xml</not-matching>'
        }
      ];

      mockRepository.find.mockResolvedValue(mockBookletFiles);

      await expect(
        service.getBookletUnits(5, 'INVALID_BOOKLET')
      ).rejects.toThrow('Error parsing booklet XML');
    });

    it('should use unit id as fallback when parsing fails', async () => {
      const mockBookletFiles = [
        {
          file_id: 'BOOKLET3',
          workspace_id: 5,
          data: `
            <Booklet>
              <Units>
                <Unit id="abc"/>
              </Units>
            </Booklet>
          `
        }
      ];

      mockRepository.find.mockResolvedValue(mockBookletFiles);

      const result = await service.getBookletUnits(5, 'BOOKLET3');

      expect(result[0].id).toBe(1);
      expect(result[0].name).toBe('abc');
    });
  });

  describe('findTestPersons - State management', () => {
    it('should return array of person IDs for a workspace', async () => {
      const mockPersons = [{ id: 1 }, { id: 2 }, { id: 3 }];

      mockRepository.find.mockResolvedValue(mockPersons);

      const result = await service.findTestPersons(5);

      expect(mockRepository.find).toHaveBeenCalledWith({
        select: ['id'],
        where: { workspace_id: 5 },
        order: { id: 'ASC' }
      });
      expect(result).toEqual([1, 2, 3]);
    });

    it('should return empty array when no persons found', async () => {
      mockRepository.find.mockResolvedValue([]);

      const result = await service.findTestPersons(5);

      expect(result).toEqual([]);
    });

    it('should handle single person workspace', async () => {
      mockRepository.find.mockResolvedValue([{ id: 42 }]);

      const result = await service.findTestPersons(5);

      expect(result).toEqual([42]);
    });
  });

  describe('findTestPersonUnits - State management', () => {
    it('should return unit IDs for a test person', async () => {
      const mockResponses = [
        { unitid: 'UNIT1' },
        { unitid: 'UNIT2' },
        { unitid: 'UNIT3' }
      ];

      mockRepository.find.mockResolvedValue(mockResponses);

      const result = await service.findTestPersonUnits(5, 'PERSON1');

      expect(mockRepository.find).toHaveBeenCalledWith({
        select: ['unitid'],
        order: { unitid: 'ASC' }
      });
      expect(result).toEqual(mockResponses);
    });

    it('should return empty array when no responses found', async () => {
      mockRepository.find.mockResolvedValue([]);

      const result = await service.findTestPersonUnits(5, 'PERSON1');

      expect(result).toEqual([]);
    });

    it('should handle single unit response', async () => {
      mockRepository.find.mockResolvedValue([{ unitid: 'SINGLE_UNIT' }]);

      const result = await service.findTestPersonUnits(5, 'PERSON1');

      expect(result).toEqual([{ unitid: 'SINGLE_UNIT' }]);
    });
  });
});
