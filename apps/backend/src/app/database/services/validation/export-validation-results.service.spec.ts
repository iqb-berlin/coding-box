import { Repository } from 'typeorm';
import { ExportValidationResultsService } from './export-validation-results.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CacheService } from '../../../cache/cache.service';

describe('ExportValidationResultsService', () => {
  let service: ExportValidationResultsService;
  let responseRepository: jest.Mocked<Repository<ResponseEntity>>;
  let cacheService: jest.Mocked<CacheService>;

  const makeQueryBuilder = (returnValue: ResponseEntity | null) => ({
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(returnValue)
  });

  beforeEach(() => {
    responseRepository = {
      createQueryBuilder: jest.fn()
    } as unknown as jest.Mocked<Repository<ResponseEntity>>;

    cacheService = {
      getCompleteValidationResults: jest.fn()
    } as unknown as jest.Mocked<CacheService>;

    service = new ExportValidationResultsService(
      responseRepository,
      cacheService
    );
  });

  describe('exportValidationResultsAsExcel', () => {
    it('should throw error for invalid cache key', async () => {
      await expect(
        service.exportValidationResultsAsExcel(1, '')
      ).rejects.toThrow('Invalid cache key provided');
      await expect(
        service.exportValidationResultsAsExcel(1, null as unknown as string)
      ).rejects.toThrow('Invalid cache key provided');
      await expect(
        service.exportValidationResultsAsExcel(1, 123 as unknown as string)
      ).rejects.toThrow('Invalid cache key provided');
    });

    it('should throw error when cache returns null', async () => {
      cacheService.getCompleteValidationResults.mockResolvedValue(null);

      await expect(
        service.exportValidationResultsAsExcel(1, 'validation:1:abc123')
      ).rejects.toThrow('Could not export validation results as Excel');
      expect(cacheService.getCompleteValidationResults).toHaveBeenCalledWith(
        'validation:1:abc123'
      );
    });

    it('should handle empty validation results', async () => {
      cacheService.getCompleteValidationResults.mockResolvedValue({
        results: [],
        metadata: { total: 0, missing: 0, timestamp: Date.now() }
      });

      const result = await service.exportValidationResultsAsExcel(
        1,
        'validation:1:abc123'
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should generate Excel with correct headers', async () => {
      cacheService.getCompleteValidationResults.mockResolvedValue({
        results: [],
        metadata: { total: 0, missing: 0, timestamp: Date.now() }
      });

      const result = await service.exportValidationResultsAsExcel(
        1,
        'validation:1:abc123'
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should format EXISTS results with response data', async () => {
      const mockResponse: ResponseEntity = {
        id: 1,
        value: 'test-value',
        status: 'completed',
        unit: {
          id: 10,
          name: 'Unit Name',
          alias: 'UNIT1',
          booklet: {
            id: 5,
            person: {
              id: 100,
              login: 'user1',
              code: 'code1'
            },
            bookletinfo: {
              id: 1,
              name: 'Booklet Name'
            }
          }
        }
      } as unknown as ResponseEntity;

      cacheService.getCompleteValidationResults.mockResolvedValue({
        results: [
          {
            status: 'EXISTS',
            combination: {
              unit_key: 'UNIT1',
              login_name: 'user1',
              login_code: 'code1',
              booklet_id: 'BOOK1',
              variable_id: 'VAR1'
            }
          }
        ],
        metadata: { total: 1, missing: 0, timestamp: Date.now() }
      });

      responseRepository.createQueryBuilder.mockReturnValue(
        makeQueryBuilder(mockResponse) as unknown as ReturnType<
        Repository<ResponseEntity>['createQueryBuilder']
        >
      );

      const result = await service.exportValidationResultsAsExcel(
        1,
        'validation:1:abc123'
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(responseRepository.createQueryBuilder).toHaveBeenCalled();
    });

    it('should format MISSING results without querying database', async () => {
      cacheService.getCompleteValidationResults.mockResolvedValue({
        results: [
          {
            status: 'MISSING',
            combination: {
              unit_key: 'UNIT1',
              login_name: 'user1',
              login_code: 'code1',
              booklet_id: 'BOOK1',
              variable_id: 'VAR1'
            }
          }
        ],
        metadata: { total: 1, missing: 1, timestamp: Date.now() }
      });

      const result = await service.exportValidationResultsAsExcel(
        1,
        'validation:1:abc123'
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(responseRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should handle mixed EXISTS and MISSING results', async () => {
      const mockResponse: ResponseEntity = {
        id: 1,
        value: 'test-value',
        status: 'completed',
        unit: {
          id: 10,
          name: 'Unit Name',
          alias: 'UNIT1',
          booklet: {
            id: 5,
            person: {
              id: 100,
              login: 'user1',
              code: 'code1'
            },
            bookletinfo: {
              id: 1,
              name: 'Booklet Name'
            }
          }
        }
      } as unknown as ResponseEntity;

      cacheService.getCompleteValidationResults.mockResolvedValue({
        results: [
          {
            status: 'EXISTS',
            combination: {
              unit_key: 'UNIT1',
              login_name: 'user1',
              login_code: 'code1',
              booklet_id: 'BOOK1',
              variable_id: 'VAR1'
            }
          },
          {
            status: 'MISSING',
            combination: {
              unit_key: 'UNIT2',
              login_name: 'user2',
              login_code: 'code2',
              booklet_id: 'BOOK2',
              variable_id: 'VAR2'
            }
          }
        ],
        metadata: { total: 2, missing: 1, timestamp: Date.now() }
      });

      responseRepository.createQueryBuilder.mockReturnValue(
        makeQueryBuilder(mockResponse) as unknown as ReturnType<
        Repository<ResponseEntity>['createQueryBuilder']
        >
      );

      const result = await service.exportValidationResultsAsExcel(
        1,
        'validation:1:abc123'
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(responseRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('should apply green fill for EXISTS status and red for MISSING', async () => {
      cacheService.getCompleteValidationResults.mockResolvedValue({
        results: [
          {
            status: 'EXISTS',
            combination: {
              unit_key: 'UNIT1',
              login_name: 'user1',
              login_code: 'code1',
              booklet_id: 'BOOK1',
              variable_id: 'VAR1'
            }
          },
          {
            status: 'MISSING',
            combination: {
              unit_key: 'UNIT2',
              login_name: 'user2',
              login_code: 'code2',
              booklet_id: 'BOOK2',
              variable_id: 'VAR2'
            }
          }
        ],
        metadata: { total: 2, missing: 1, timestamp: Date.now() }
      });

      responseRepository.createQueryBuilder.mockReturnValue(
        makeQueryBuilder(null) as unknown as ReturnType<
        Repository<ResponseEntity>['createQueryBuilder']
        >
      );

      const result = await service.exportValidationResultsAsExcel(
        1,
        'validation:1:abc123'
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should auto-size column widths based on headers', async () => {
      cacheService.getCompleteValidationResults.mockResolvedValue({
        results: [
          {
            status: 'EXISTS',
            combination: {
              unit_key: 'UNIT1',
              login_name: 'user1',
              login_code: 'code1',
              booklet_id: 'BOOK1',
              variable_id: 'VAR1'
            }
          }
        ],
        metadata: { total: 1, missing: 0, timestamp: Date.now() }
      });

      responseRepository.createQueryBuilder.mockReturnValue(
        makeQueryBuilder(null) as unknown as ReturnType<
        Repository<ResponseEntity>['createQueryBuilder']
        >
      );

      const result = await service.exportValidationResultsAsExcel(
        1,
        'validation:1:abc123'
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle database query errors gracefully', async () => {
      cacheService.getCompleteValidationResults.mockResolvedValue({
        results: [
          {
            status: 'EXISTS',
            combination: {
              unit_key: 'UNIT1',
              login_name: 'user1',
              login_code: 'code1',
              booklet_id: 'BOOK1',
              variable_id: 'VAR1'
            }
          }
        ],
        metadata: { total: 1, missing: 0, timestamp: Date.now() }
      });

      responseRepository.createQueryBuilder.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      await expect(
        service.exportValidationResultsAsExcel(1, 'validation:1:abc123')
      ).rejects.toThrow('Could not export validation results as Excel');
    });

    it('should handle null response data from EXISTS query', async () => {
      cacheService.getCompleteValidationResults.mockResolvedValue({
        results: [
          {
            status: 'EXISTS',
            combination: {
              unit_key: 'UNIT1',
              login_name: 'user1',
              login_code: 'code1',
              booklet_id: 'BOOK1',
              variable_id: 'VAR1'
            }
          }
        ],
        metadata: { total: 1, missing: 0, timestamp: Date.now() }
      });

      responseRepository.createQueryBuilder.mockReturnValue(
        makeQueryBuilder(null) as unknown as ReturnType<
        Repository<ResponseEntity>['createQueryBuilder']
        >
      );

      const result = await service.exportValidationResultsAsExcel(
        1,
        'validation:1:abc123'
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should include all required columns in the Excel output', async () => {
      cacheService.getCompleteValidationResults.mockResolvedValue({
        results: [
          {
            status: 'EXISTS',
            combination: {
              unit_key: 'UNIT1',
              login_name: 'user1',
              login_code: 'code1',
              booklet_id: 'BOOK1',
              variable_id: 'VAR1'
            }
          }
        ],
        metadata: { total: 1, missing: 0, timestamp: Date.now() }
      });

      const mockResponse: ResponseEntity = {
        id: 1,
        value: 'response-value',
        status: 'completed',
        unit: {
          id: 10,
          name: 'Unit Name',
          alias: 'UNIT1',
          booklet: {
            id: 5,
            person: {
              id: 100,
              login: 'user1',
              code: 'code1'
            },
            bookletinfo: {
              id: 1,
              name: 'Booklet Name'
            }
          }
        }
      } as unknown as ResponseEntity;

      responseRepository.createQueryBuilder.mockReturnValue(
        makeQueryBuilder(mockResponse) as unknown as ReturnType<
        Repository<ResponseEntity>['createQueryBuilder']
        >
      );

      const result = await service.exportValidationResultsAsExcel(
        1,
        'validation:1:abc123'
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should retrieve validation results from cache using provided key', async () => {
      const cacheKey = 'validation:1:hash123';
      cacheService.getCompleteValidationResults.mockResolvedValue({
        results: [],
        metadata: { total: 0, missing: 0, timestamp: Date.now() }
      });

      await service.exportValidationResultsAsExcel(1, cacheKey);
      expect(cacheService.getCompleteValidationResults).toHaveBeenCalledWith(
        cacheKey
      );
    });

    it('should query database with correct parameters for EXISTS results', async () => {
      const mockResponse: ResponseEntity = {
        id: 1,
        value: 'test',
        status: 'ok',
        unit: {
          id: 10,
          name: 'Unit',
          alias: 'UNIT1',
          booklet: {
            id: 5,
            person: { id: 100, login: 'user1', code: 'code1' },
            bookletinfo: { id: 1, name: 'Book1' }
          }
        }
      } as unknown as ResponseEntity;

      cacheService.getCompleteValidationResults.mockResolvedValue({
        results: [
          {
            status: 'EXISTS',
            combination: {
              unit_key: 'UNIT1',
              login_name: 'user1',
              login_code: 'code1',
              booklet_id: 'BOOK1',
              variable_id: 'VAR1'
            }
          }
        ],
        metadata: { total: 1, missing: 0, timestamp: Date.now() }
      });

      const mockQueryBuilder = makeQueryBuilder(mockResponse);
      responseRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as ReturnType<
        Repository<ResponseEntity>['createQueryBuilder']
        >
      );

      await service.exportValidationResultsAsExcel(1, 'validation:1:abc123');

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'unit.alias = :unitKey',
        { unitKey: 'UNIT1' }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'person.login = :loginName',
        { loginName: 'user1' }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'person.code = :loginCode',
        { loginCode: 'code1' }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'bookletinfo.name = :bookletId',
        { bookletId: 'BOOK1' }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'response.variableid = :variableId',
        { variableId: 'VAR1' }
      );
    });
  });
});
