import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

// This is required workflow state, not a best-effort cache. Keep the update and
// TTL refresh atomic so concurrent chunk requests cannot lose one another.
export const RECORD_UPLOAD_CHUNK = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -1 end
local session = cjson.decode(raw)
local index = tonumber(ARGV[1])
for _, received in ipairs(session.receivedChunks) do
  if received == index then
    redis.call('EXPIRE', KEYS[1], ARGV[2])
    return #session.receivedChunks
  end
end
table.insert(session.receivedChunks, index)
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ARGV[2])
return #session.receivedChunks
`;

@Injectable()
export class UploadSessionStore {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value === null ? null : JSON.parse(value) as T;
    } catch {
      throw new ServiceUnavailableException('Upload session storage is unavailable');
    }
  }

  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
    } catch {
      throw new ServiceUnavailableException('Upload session could not be saved');
    }
  }

  async recordChunk(key: string, index: number, ttl: number): Promise<number> {
    let count: number;
    try {
      count = Number(await this.redis.eval(RECORD_UPLOAD_CHUNK, 1, key, index, ttl));
    } catch {
      throw new ServiceUnavailableException('Upload progress could not be saved');
    }
    if (count < 0) throw new NotFoundException('Upload session expired');
    return count;
  }
}
