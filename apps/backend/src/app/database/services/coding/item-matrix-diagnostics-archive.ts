import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ItemMatrixDiagnosticsArchiveEntryDto,
  ItemMatrixExportDiagnosticsDto
} from '../../../../../../../api-dto/coding/export-request.dto';

interface ArchivedDiagnostics {
  entry: ItemMatrixDiagnosticsArchiveEntryDto;
  diagnostics: ItemMatrixExportDiagnosticsDto;
}

/** Stored on the shared export volume, independently of Redis and Bull. */
export class ItemMatrixDiagnosticsArchive {
  getRootDirectory(): string {
    return path.join(process.cwd(), 'temp', 'item-matrix-diagnostics');
  }

  private workspaceDirectory(workspaceId: number): string {
    if (!Number.isSafeInteger(workspaceId) || workspaceId < 1) {
      throw new Error('Invalid diagnostics workspace');
    }
    return path.join(this.getRootDirectory(), String(workspaceId));
  }

  private archiveDirectory(workspaceId: number, archiveId: string): string | null {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(archiveId)) {
      return null;
    }
    return path.join(this.workspaceDirectory(workspaceId), archiveId);
  }

  async publish(
    workspaceId: number,
    entry: Omit<ItemMatrixDiagnosticsArchiveEntryDto, 'archiveId'>,
    diagnostics: ItemMatrixExportDiagnosticsDto,
    csvPath: string
  ): Promise<string> {
    const archiveId = randomUUID();
    const workspaceDirectory = this.workspaceDirectory(workspaceId);
    await fs.promises.mkdir(workspaceDirectory, { recursive: true, mode: 0o700 });
    const staging = await fs.promises.mkdtemp(path.join(workspaceDirectory, '.working-'));
    try {
      await fs.promises.copyFile(csvPath, path.join(staging, 'diagnose.csv'));
      await fs.promises.chmod(path.join(staging, 'diagnose.csv'), 0o600);
      await fs.promises.writeFile(path.join(staging, 'metadata.json'), JSON.stringify({
        ...entry, archiveId
      }), { mode: 0o600 });
      await fs.promises.writeFile(path.join(staging, 'diagnostics.json'), JSON.stringify({
        ...diagnostics, archiveId
      }), { mode: 0o600 });
      await fs.promises.rename(staging, path.join(workspaceDirectory, archiveId));
      return archiveId;
    } finally {
      await fs.promises.rm(staging, { recursive: true, force: true });
    }
  }

  async get(workspaceId: number, archiveId: string): Promise<ArchivedDiagnostics | null> {
    const entry = await this.getEntry(workspaceId, archiveId);
    if (!entry) return null;
    try {
      const diagnostics = JSON.parse(await fs.promises.readFile(
        path.join(this.archiveDirectory(workspaceId, archiveId)!, 'diagnostics.json'), 'utf8'
      )) as ItemMatrixExportDiagnosticsDto;
      return { entry, diagnostics };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async getEntry(workspaceId: number, archiveId: string): Promise<ItemMatrixDiagnosticsArchiveEntryDto | null> {
    const directory = this.archiveDirectory(workspaceId, archiveId);
    if (!directory) return null;
    try {
      const metadata = JSON.parse(await fs.promises.readFile(
        path.join(directory, 'metadata.json'), 'utf8'
      )) as ItemMatrixDiagnosticsArchiveEntryDto;
      await fs.promises.access(path.join(directory, 'diagnose.csv'));
      return metadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async getCsvPath(workspaceId: number, archiveId: string): Promise<string | null> {
    return await this.getEntry(workspaceId, archiveId) ?
      path.join(this.archiveDirectory(workspaceId, archiveId)!, 'diagnose.csv') : null;
  }

  async list(workspaceId: number): Promise<ItemMatrixDiagnosticsArchiveEntryDto[]> {
    let names: string[];
    try {
      names = await fs.promises.readdir(this.workspaceDirectory(workspaceId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const entries: ItemMatrixDiagnosticsArchiveEntryDto[] = [];
    for (const name of names) {
      const entry = await this.getEntry(workspaceId, name);
      if (entry) entries.push(entry);
    }
    return entries.sort((left, right) => right.createdAt - left.createdAt ||
      left.archiveId.localeCompare(right.archiveId));
  }

  async removeWorkspace(workspaceId: number): Promise<void> {
    await fs.promises.rm(this.workspaceDirectory(workspaceId), { recursive: true, force: true });
  }

  async remove(workspaceId: number, archiveId: string): Promise<void> {
    const directory = this.archiveDirectory(workspaceId, archiveId);
    if (directory) await fs.promises.rm(directory, { recursive: true, force: true });
  }
}
