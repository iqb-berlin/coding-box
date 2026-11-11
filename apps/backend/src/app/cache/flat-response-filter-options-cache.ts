import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { getErrorMessage, getErrorStack } from '../utils/error.util';

const logger = new Logger('FlatResponseFilterOptionsCache');
const GENERATION_PREFIX = 'g2-';
const READ_GENERATION = `
  local generation = redis.call('GET', KEYS[1])
  if not generation or string.sub(generation, 1, 3) ~= 'g2-' then
    generation = ARGV[1]
    redis.call('SET', KEYS[1], generation)
  end
  return generation
`;
const PUBLISH_CURRENT_GENERATION = `
  if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
  redis.call('SET', KEYS[2], ARGV[2])
  return 1
`;

type Coalesce<T> = (
  key: string,
  compute: () => Promise<T>,
  publish: (value: T) => Promise<boolean>
) => Promise<T>;

export function flatResponseFilterOptionsVersionKey(workspaceId: number): string {
  return `flat_response_filter_options:version:${workspaceId}`;
}

export function flatResponseFilterOptionsCacheKey(
  workspaceId: number, generation: string | number, threshold: number
): string {
  return `flat_response_filter_options:${workspaceId}:v${generation}:thr${threshold}`;
}

async function publishIfCurrent<T>(
  redis: Redis, versionKey: string, cacheKey: string, generation: string, value: T
): Promise<boolean> {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return false;
    return await redis.eval(
      PUBLISH_CURRENT_GENERATION, 2, versionKey, cacheKey, generation, serialized
    ) === 1;
  } catch (error) {
    logger.error(`Error publishing filter options: ${getErrorMessage(error)}`, getErrorStack(error));
    return false;
  }
}

/** Missing/deleted counters get a fresh identity instead of reusing version 1. */
export async function getOrComputeFlatResponseFilterOptions<T>(
  redis: Redis, coalesce: Coalesce<T>, workspaceId: number, threshold: number,
  compute: () => Promise<T>
): Promise<T> {
  const versionKey = flatResponseFilterOptionsVersionKey(workspaceId);
  let generation: string;
  try {
    const value = await redis.eval(READ_GENERATION, 1, versionKey, `${GENERATION_PREFIX}${randomUUID()}`);
    if (typeof value !== 'string') throw new Error('Invalid filter-options generation');
    generation = value;
  } catch (error) {
    logger.error(`Error reading filter-options generation: ${getErrorMessage(error)}`, getErrorStack(error));
    // An unavailable generation must not attach a new read to an old computation.
    return compute();
  }
  const cacheKey = flatResponseFilterOptionsCacheKey(workspaceId, generation, threshold);
  return coalesce(cacheKey, compute, value => (
    publishIfCurrent(redis, versionKey, cacheKey, generation, value)
  ));
}

export async function invalidateFlatResponseFilterOptions(
  redis: Redis, deleteValues: (pattern: string) => Promise<boolean>, workspaceId: number
): Promise<string | null> {
  try {
    const generation = `${GENERATION_PREFIX}${randomUUID()}`;
    await redis.set(flatResponseFilterOptionsVersionKey(workspaceId), generation);
    return await deleteValues(`flat_response_filter_options:${workspaceId}:*`) ? generation : null;
  } catch (error) {
    logger.error(`Error invalidating filter options: ${getErrorMessage(error)}`, getErrorStack(error));
    return null;
  }
}
