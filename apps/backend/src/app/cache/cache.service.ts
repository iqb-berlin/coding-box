import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { ValidationResultDto } from '../../../../../api-dto/coding/validation-result.dto';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly DEFAULT_TTL = 86400; // 24 Stunden in Sekunden
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async getNumber(key: string, fallback: number): Promise<number> {
    try {
      const raw = await this.redis.get(key);
      const parsed = raw != null ? Number(raw) : NaN;
      return Number.isFinite(parsed) ? parsed : fallback;
    } catch (error) {
      this.logger.error(
        `Error getting number from cache: ${error.message}`,
        error.stack
      );
      return fallback;
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.redis.incr(key);
    } catch (error) {
      this.logger.error(
        `Error incrementing cache key: ${error.message}`,
        error.stack
      );
      return 0;
    }
  }

  generateFlatResponseFilterOptionsVersionKey(workspaceId: number): string {
    return `flat_response_filter_options:version:${workspaceId}`;
  }

  generateFlatResponseFilterOptionsCacheKey(
    workspaceId: number,
    cacheVersion: number,
    processingDurationThresholdMs: number
  ): string {
    return `flat_response_filter_options:${workspaceId}:v${cacheVersion}:thr${processingDurationThresholdMs}`;
  }

  /**
   * Get a value from the cache
   * @param key The cache key
   * @returns The cached value or null if not found
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const cachedValue = await this.redis.get(key);
      if (!cachedValue) {
        return null;
      }
      return JSON.parse(cachedValue) as T;
    } catch (error) {
      this.logger.error(
        `Error getting value from cache: ${error.message}`,
        error.stack
      );
      return null;
    }
  }

  /**
   * Set a value in the cache
   * @param key The cache key
   * @param value The value to cache
   * @param ttl Time to live in seconds (optional, defaults to 1 hour, use 0 for no expiration)
   * @returns True if the value was set, false otherwise
   */
  async set<T>(
    key: string,
    value: T,
    ttl: number = this.DEFAULT_TTL
  ): Promise<boolean> {
    try {
      const serializedValue = JSON.stringify(value);
      if (ttl > 0) {
        await this.redis.set(key, serializedValue, 'EX', ttl);
      } else {
        await this.redis.set(key, serializedValue);
      }
      return true;
    } catch (error) {
      this.logger.error(
        `Error setting value in cache: ${error.message}`,
        error.stack
      );
      return false;
    }
  }

  /**
   * Delete a value from the cache
   * @param key The cache key
   * @returns True if the value was deleted, false otherwise
   */
  async delete(key: string): Promise<boolean> {
    try {
      await this.redis.del(key);
      return true;
    } catch (error) {
      this.logger.error(
        `Error deleting value from cache: ${error.message}`,
        error.stack
      );
      return false;
    }
  }

  /**
   * Check if a key exists in the cache
   * @param key The cache key
   * @returns True if the key exists, false otherwise
   */
  async exists(key: string): Promise<boolean> {
    try {
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (error) {
      this.logger.error(
        `Error checking if key exists in cache: ${error.message}`,
        error.stack
      );
      return false;
    }
  }

  /**
   * Generate a cache key for unit responses
   * @param workspaceId The workspace ID
   * @param testPerson The test person ID
   * @param unitId The unit ID
   * @returns The cache key
   */
  generateUnitResponseCacheKey(
    workspaceId: number,
    testPerson: string,
    unitId: string
  ): string {
    return `responses:${workspaceId}:${testPerson}:${unitId}`;
  }

  /**
   * Generate a cache key for validation results
   * @param workspaceId The workspace ID
   * @param hash Hash of expected combinations to ensure uniqueness
   * @returns The cache key for validation results
   */
  generateValidationCacheKey(workspaceId: number, hash: string): string {
    return `validation:${workspaceId}:${hash}`;
  }

  /**
   * Store complete validation results in cache
   * @param cacheKey The cache key
   * @param results Complete validation results
   * @param metadata Additional metadata (total, missing counts, etc.)
   * @param ttl Time to live in seconds (defaults to 2 hours for validation results)
   * @returns True if stored successfully
   */
  async storeValidationResults(
    cacheKey: string,
    results: ValidationResultDto[],
    metadata: {
      total: number;
      missing: number;
      timestamp: number;
    },
    ttl: number = 7200 // 2 hours default for validation results
  ): Promise<boolean> {
    try {
      const cacheData = {
        results,
        metadata,
        cachedAt: Date.now()
      };

      const serializedValue = JSON.stringify(cacheData);
      if (ttl > 0) {
        await this.redis.set(cacheKey, serializedValue, 'EX', ttl);
      } else {
        await this.redis.set(cacheKey, serializedValue);
      }
      this.logger.log(
        `Stored validation results in cache: ${cacheKey} (${results.length} results)`
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Error storing validation results in cache: ${error.message}`,
        error.stack
      );
      return false;
    }
  }

  /**
   * Retrieve paginated validation results from cache
   * @param cacheKey The cache key
   * @param page Page number (1-based)
   * @param pageSize Number of items per page
   * @returns Paginated validation results with metadata
   */
  async getPaginatedValidationResults(
    cacheKey: string,
    page: number,
    pageSize: number
  ): Promise<{
      results: ValidationResultDto[];
      metadata: {
        total: number;
        missing: number;
        timestamp: number;
        currentPage: number;
        pageSize: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
      };
    } | null> {
    try {
      const cachedData = await this.get<{
        results: ValidationResultDto[];
        metadata: {
          total: number;
          missing: number;
          timestamp: number;
        };
        cachedAt: number;
      }>(cacheKey);

      if (!cachedData) {
        return null;
      }

      const { results, metadata } = cachedData;

      // Calculate pagination
      const totalPages = Math.ceil(results.length / pageSize);
      const startIndex = (page - 1) * pageSize;
      const endIndex = Math.min(startIndex + pageSize, results.length);
      const paginatedResults = results.slice(startIndex, endIndex);

      return {
        results: paginatedResults,
        metadata: {
          ...metadata,
          currentPage: page,
          pageSize,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1
        }
      };
    } catch (error) {
      this.logger.error(
        `Error retrieving paginated validation results from cache: ${error.message}`,
        error.stack
      );
      return null;
    }
  }

  /**
   * Get complete validation results from cache (for Excel export)
   * @param cacheKey The cache key
   * @returns Complete validation results or null if not found
   */
  async getCompleteValidationResults(cacheKey: string): Promise<{
    results: ValidationResultDto[];
    metadata: {
      total: number;
      missing: number;
      timestamp: number;
    };
  } | null> {
    try {
      this.logger.log(
        `Attempting to retrieve complete validation results from cache with key: ${cacheKey}`
      );

      const cachedData = await this.get<{
        results: ValidationResultDto[];
        metadata: {
          total: number;
          missing: number;
          timestamp: number;
        };
        cachedAt: number;
      }>(cacheKey);

      if (!cachedData) {
        this.logger.warn(`No cached data found for key: ${cacheKey}`);
        // Check if key exists at all
        const keyExists = await this.exists(cacheKey);
        this.logger.warn(`Key exists in Redis: ${keyExists}`);
        return null;
      }

      this.logger.log(
        `Successfully retrieved cached validation results: ${cachedData.results.length} items`
      );
      this.logger.log(
        `Cache metadata - Total: ${cachedData.metadata.total}, Missing: ${cachedData.metadata.missing}`
      );

      return {
        results: cachedData.results,
        metadata: cachedData.metadata
      };
    } catch (error) {
      this.logger.error(
        `Error retrieving complete validation results from cache: ${error.message}`,
        error.stack
      );
      return null;
    }
  }
}
