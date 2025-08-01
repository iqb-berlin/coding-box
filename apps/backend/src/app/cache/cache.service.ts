import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly DEFAULT_TTL = 3600; // 1 hour in seconds

  constructor(
    @InjectRedis() private readonly redis: Redis
  ) {}

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
      this.logger.error(`Error getting value from cache: ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Set a value in the cache
   * @param key The cache key
   * @param value The value to cache
   * @param ttl Time to live in seconds (optional, defaults to 1 hour)
   * @returns True if the value was set, false otherwise
   */
  async set<T>(key: string, value: T, ttl: number = this.DEFAULT_TTL): Promise<boolean> {
    try {
      const serializedValue = JSON.stringify(value);
      await this.redis.set(key, serializedValue, 'EX', ttl);
      return true;
    } catch (error) {
      this.logger.error(`Error setting value in cache: ${error.message}`, error.stack);
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
      this.logger.error(`Error deleting value from cache: ${error.message}`, error.stack);
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
      this.logger.error(`Error checking if key exists in cache: ${error.message}`, error.stack);
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
  generateUnitResponseCacheKey(workspaceId: number, testPerson: string, unitId: string): string {
    return `responses:${workspaceId}:${testPerson}:${unitId}`;
  }
}
