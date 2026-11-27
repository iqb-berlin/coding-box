import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { BadRequestException } from '@nestjs/common';

function chunkPath(directory: string, index: number): string {
  return join(directory, `chunk_${String(index).padStart(6, '0')}`);
}

export async function hasAssembledUpload(directory: string, expectedSize: number): Promise<boolean> {
  try {
    const file = await stat(join(directory, 'merged.csv'));
    return file.isFile() && file.size === expectedSize;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function assembleChunkedUpload(directory: string, count: number, expectedSize: number): Promise<string> {
  const partial = join(directory, `${randomUUID()}.partial`);
  const merged = join(directory, 'merged.csv');
  if (await hasAssembledUpload(directory, expectedSize)) return merged;

  async function* readChunks() {
    for (let index = 0; index < count; index++) {
      yield* createReadStream(chunkPath(directory, index));
    }
  }

  try {
    await pipeline(readChunks(), createWriteStream(partial, { flags: 'wx' }));
    if ((await stat(partial)).size !== expectedSize) {
      throw new BadRequestException('The uploaded file size does not match the declared size.');
    }
    await rename(partial, merged);
    return merged;
  } finally {
    await rm(partial, { force: true });
  }
}

export async function removeUploadChunks(directory: string, count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await rm(chunkPath(directory, index), { force: true });
  }
}
