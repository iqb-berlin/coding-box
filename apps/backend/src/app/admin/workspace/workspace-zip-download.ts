import {
  BadRequestException, Logger, NotFoundException, ServiceUnavailableException, StreamableFile
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Response } from 'express';

const segmentSize = 8 * 1024 * 1024;
const storageLimit = 1024 * 1024 * 1024;
const retentionMs = 15 * 60 * 1000;

interface Archive {
  workspaceId: number;
  path: string;
  size: number;
}

export class WorkspaceZipDownload {
  private readonly logger = new Logger(WorkspaceZipDownload.name);
  private readonly archives = new Map<string, Archive>();
  private storedBytes = 0;

  async start(workspaceId: number, data: Buffer, segmented: boolean, response: Response): Promise<StreamableFile> {
    if (!segmented || data.length <= segmentSize) {
      return new StreamableFile(data, {
        type: 'application/zip',
        disposition: `attachment; filename="workspace-${workspaceId}-files.zip"`
      });
    }
    if (this.storedBytes + data.length > storageLimit) {
      throw new ServiceUnavailableException('ZIP download storage is full. Try again later.');
    }

    const size = data.length;
    this.storedBytes += size;
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(tmpdir(), 'kodierbox-workspace-zip-'));
      const path = join(directory, 'workspace.zip');
      await writeFile(path, data, { mode: 0o600 });
      const id = randomUUID();
      this.archives.set(id, { path, workspaceId, size });
      setTimeout(() => {
        this.archives.delete(id);
        this.discard(directory, size);
      }, retentionMs).unref();
      return this.segment(workspaceId, id, 0, response);
    } catch (error) {
      this.discard(directory, size);
      throw error;
    }
  }

  segment(workspaceId: number, id: string, offset: number, response: Response): StreamableFile {
    const archive = this.archives.get(id);
    if (!archive || archive.workspaceId !== workspaceId) {
      throw new NotFoundException('ZIP archive unavailable');
    }
    if (offset < 0 || offset >= archive.size || offset % segmentSize !== 0) {
      throw new BadRequestException('Invalid ZIP segment offset');
    }

    const end = Math.min(offset + segmentSize, archive.size) - 1;
    response.setHeader('X-Archive-Range', `bytes ${offset}-${end}/${archive.size}`);
    response.setHeader('X-Archive-Id', id);
    response.setHeader('Cache-Control', 'no-store, no-transform');
    const stream = createReadStream(archive.path, { start: offset, end });
    return new StreamableFile(stream, {
      type: 'application/octet-stream',
      length: end - offset + 1
    });
  }

  private discard(directory: string | undefined, size: number): void {
    if (!directory) {
      this.storedBytes -= size;
      return;
    }
    rm(directory, { recursive: true, force: true }).then(() => {
      this.storedBytes -= size;
    }).catch(() => this.logger.warn('Could not remove expired workspace ZIP'));
  }
}
