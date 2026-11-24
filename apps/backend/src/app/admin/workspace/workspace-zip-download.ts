import {
  BadRequestException, Logger, NotFoundException, ServiceUnavailableException, StreamableFile
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import type { NextFunction, Response } from 'express';
import { WorkspaceDownloadTicket, workspaceDownloadLifetimeMs } from './workspace-download-ticket';

const segmentSize = 8 * 1024 * 1024;
const storageLimit = 1024 * 1024 * 1024;

interface Archive {
  workspaceId: number;
  path: string;
  size: number;
  prepared: boolean;
  directory: string;
  expiry: ReturnType<typeof setTimeout>;
  active: number;
}

export class WorkspaceZipDownload {
  private readonly logger = new Logger(WorkspaceZipDownload.name);
  private readonly archives = new Map<string, Archive>();
  private readonly ticket = new WorkspaceDownloadTicket();
  private storedBytes = 0;

  async start(workspaceId: number, data: Buffer, segmented: boolean, response: Response): Promise<StreamableFile> {
    if (!segmented || data.length <= segmentSize) {
      return new StreamableFile(data, {
        type: 'application/zip',
        disposition: `attachment; filename="workspace-${workspaceId}-files.zip"`
      });
    }
    const id = await this.store(workspaceId, data);
    return this.segment(workspaceId, id, 0, response);
  }

  async prepare(workspaceId: number, data: Buffer, route: string, response: Response): Promise<{ id: string }> {
    const id = await this.store(workspaceId, data, true);
    this.ticket.issue(`${route}/${id}/download`, response);
    return { id };
  }

  download(
    workspaceId: number,
    id: string,
    path: string,
    cookie: string | undefined,
    response: Response,
    next: NextFunction
  ): void {
    const archive = this.archives.get(id);
    if (!archive?.prepared || archive.workspaceId !== workspaceId || !this.ticket.matches(path, cookie)) {
      throw new NotFoundException('ZIP archive unavailable');
    }
    archive.active += 1;
    response.download(archive.path, `workspace-${workspaceId}-files.zip`, {
      headers: { 'Cache-Control': 'no-store, no-transform' }
    }, error => {
      if (error) {
        this.completeTransfer(id, archive, false);
        if (!response.destroyed) next(error);
      } else {
        // Express can finish reading the file before the HTTP response finishes.
        finished(response, { readable: false, cleanup: true }).then(
          () => this.completeTransfer(id, archive, this.isFullTransfer(response, archive.size)),
          () => this.completeTransfer(id, archive, false)
        );
      }
    });
  }

  private completeTransfer(id: string, archive: Archive, fullTransfer: boolean): void {
    archive.active -= 1;
    if (!this.archives.has(id)) {
      this.discardIfIdle(archive);
    } else if (fullTransfer) {
      this.retire(id, archive);
    }
  }

  private isFullTransfer(response: Response, size: number): boolean {
    return response.req.method === 'GET' &&
      (response.statusCode === 200 ||
        response.getHeader('Content-Range') === `bytes 0-${size - 1}/${size}`);
  }

  private retire(id: string, archive: Archive): void {
    clearTimeout(archive.expiry);
    this.archives.delete(id);
    this.discardIfIdle(archive);
  }

  private discardIfIdle(archive: Archive): void {
    if (archive.active === 0) this.discard(archive.directory, archive.size);
  }

  private async store(workspaceId: number, data: Buffer, prepared = false): Promise<string> {
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
      const expiry = setTimeout(() => {
        const archive = this.archives.get(id);
        if (archive) this.retire(id, archive);
      }, workspaceDownloadLifetimeMs).unref();
      this.archives.set(id, {
        path, workspaceId, size, prepared, directory, expiry, active: 0
      });
      return id;
    } catch (error) {
      this.discard(directory, size);
      throw error;
    }
  }

  segment(workspaceId: number, id: string, offset: number, response: Response): StreamableFile {
    const archive = this.archives.get(id);
    if (!archive || archive.prepared || archive.workspaceId !== workspaceId) {
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
    }).catch(() => this.logger.warn('Could not remove temporary workspace ZIP'));
  }
}
