import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getErrorMessage, getErrorStack } from '../../../utils/error.util';
import FileUpload from '../../entities/file_upload.entity';
import { CodingStatisticsService } from '../coding/coding-statistics.service';
import { withWorkspaceFilesMutationLock } from '../shared/workspace-files-lock.util';
import { WorkspaceFileCacheService } from './workspace-file-cache.service';
import { getWorkspaceFilesMutationContext, WorkspaceFilesMutationContext } from './workspace-file-write.util';

@Injectable()
export class WorkspaceFileMutationService {
  private readonly logger = new Logger(WorkspaceFileMutationService.name);

  constructor(
    @InjectRepository(FileUpload) private readonly fileUploadRepository: Repository<FileUpload>,
    private readonly caches: WorkspaceFileCacheService,
    private readonly codingStatisticsService: CodingStatisticsService
  ) {}

  async deleteTestFiles(
    workspace_id: number,
    fileIds: string[]
  ): Promise<boolean> {
    return withWorkspaceFilesMutationLock(
      this.fileUploadRepository.manager.connection,
      workspace_id,
      queryRunner => this.deleteTestFilesUnlocked(
        workspace_id,
        fileIds,
        getWorkspaceFilesMutationContext(queryRunner)
      )
    );
  }

  private async deleteTestFilesUnlocked(
    workspace_id: number,
    fileIds: string[],
    mutationContext: WorkspaceFilesMutationContext
  ): Promise<boolean> {
    this.logger.log(`Delete test files for workspace ${workspace_id}`);
    const numericIds = Array.from(new Set(
      fileIds
        .filter(id => /^[1-9]\d*$/.test(id))
        .map(id => Number(id))
        .filter(id => Number.isSafeInteger(id))
    ));

    if (numericIds.length === 0) {
      this.logger.warn(
        `No valid test file IDs provided for workspace ${workspace_id}`
      );
      return false;
    }

    const res = await mutationContext.fileUploadRepository
      .createQueryBuilder()
      .delete()
      .from(FileUpload)
      .where('workspace_id = :workspaceId', { workspaceId: workspace_id })
      .andWhere('id IN (:...ids)', { ids: numericIds })
      .execute();

    // Preserve cache invalidation before checking for partial deletion.
    await this.caches.invalidateWorkspaceFileCaches(workspace_id);

    // Invalidate coding statistics cache since test files changed
    await this.codingStatisticsService.invalidateCache(workspace_id);

    const deletedCount = res.affected ?? 0;
    const success = deletedCount === numericIds.length;
    if (!success) {
      this.logger.warn(
        `Requested deletion of ${numericIds.length} test files for workspace ${workspace_id}, but deleted ${deletedCount}`
      );
    }

    return success;
  }

  async createDummyTestTakerFile(workspaceId: number): Promise<boolean> {
    return withWorkspaceFilesMutationLock(
      this.fileUploadRepository.manager.connection,
      workspaceId,
      queryRunner => this.createDummyTestTakerFileUnlocked(
        workspaceId,
        getWorkspaceFilesMutationContext(queryRunner)
      )
    );
  }

  private async createDummyTestTakerFileUnlocked(
    workspaceId: number,
    mutationContext: WorkspaceFilesMutationContext
  ): Promise<boolean> {
    const { fileUploadRepository } = mutationContext;
    try {
      const booklets = await fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'Booklet' }
      });

      if (!booklets || booklets.length === 0) {
        const units = await fileUploadRepository.find({
          where: { workspace_id: workspaceId, file_type: 'Unit' }
        });

        if (!units || units.length === 0) {
          this.logger.warn(
            `No booklets or units found in workspace with ID ${workspaceId}.`
          );
          return false;
        }

        return await this.createDummyFilesFromUnits(workspaceId, units, fileUploadRepository);
      }

      const bookletRefs = booklets
        .map(booklet => `    <Booklet>${booklet.file_id}</Booklet>`)
        .join('\n');

      const dummyTestTakerXml = `<?xml version="1.0" encoding="utf-8"?>
<TestTakers>
  <Metadata>
    <Description>Auto-generated TestTakers file including all booklets</Description>
  </Metadata>
  <Group id="auto-generated" label="Auto-generated">
    <Login name="auto-generated" mode="run-hot-return">
${bookletRefs}
    </Login>
  </Group>
</TestTakers>`;

      const newTestTakerFile = fileUploadRepository.create({
        workspace_id: workspaceId,
        filename: 'auto-generated-testtakers.xml',
        file_id: 'AUTO-GENERATED-TESTTAKERS',
        file_type: 'TestTakers',
        file_size: dummyTestTakerXml.length,
        data: dummyTestTakerXml
      });

      await fileUploadRepository.save(newTestTakerFile);

      this.logger.log(
        `Created dummy TestTakers file for workspace ${workspaceId} with ${booklets.length} booklets.`
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Error creating dummy TestTakers file for workspace ${workspaceId}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return false;
    }
  }

  private async createDummyFilesFromUnits(workspaceId: number, units: FileUpload[], fileUploadRepository: Repository<FileUpload>): Promise<boolean> {
    // Create a fake booklet that includes all available units
    const unitRefs = units
      .map(unit => `  <Unit id="${unit.file_id}"/>`)
      .join('\n');
    const fakeBookletId = 'AUTO-GENERATED-BOOKLET';
    const fakeBookletXml = `<?xml version="1.0" encoding="utf-8"?>
<Booklet>
  <Metadata>
    <Id>${fakeBookletId}</Id>
    <Label>Auto-generated Booklet</Label>
    <Description>Auto-generated booklet including all units</Description>
  </Metadata>
  <Units>
${unitRefs}
  </Units>
</Booklet>`;

    const fakeBooklet = fileUploadRepository.create({
      workspace_id: workspaceId,
      filename: 'auto-generated-booklet.xml',
      file_id: fakeBookletId,
      file_type: 'Booklet',
      file_size: fakeBookletXml.length,
      data: fakeBookletXml
    });

    await fileUploadRepository.save(fakeBooklet);
    this.logger.log(
      `Created fake booklet for workspace ${workspaceId} with ${units.length} units.`
    );

    const dummyTestTakerXml = `<?xml version="1.0" encoding="utf-8"?>
<TestTakers>
  <Metadata>
    <Description>Auto-generated TestTakers file with auto-generated booklet</Description>
  </Metadata>
  <Group id="auto-generated" label="Auto-generated">
    <Login name="auto-generated" mode="run-hot-return">
      <Booklet>${fakeBookletId}</Booklet>
    </Login>
  </Group>
</TestTakers>`;

    const newTestTakerFile = fileUploadRepository.create({
      workspace_id: workspaceId,
      filename: 'auto-generated-testtakers.xml',
      file_id: 'AUTO-GENERATED-TESTTAKERS',
      file_type: 'TestTakers',
      file_size: dummyTestTakerXml.length,
      data: dummyTestTakerXml
    });

    await fileUploadRepository.save(newTestTakerFile);
    this.logger.log(
      `Created dummy TestTakers file for workspace ${workspaceId} with auto-generated booklet.`
    );
    return true;
  }
}
