import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheClientModule } from '../cache/cache-client.module';
import FileUpload from '../database/entities/file_upload.entity';
import Workspace from '../database/entities/workspace.entity';
import Persons from '../database/entities/persons.entity';
import { ResponseEntity } from '../database/entities/response.entity';
import { Unit } from '../database/entities/unit.entity';
import { Booklet } from '../database/entities/booklet.entity';
import { BookletInfo } from '../database/entities/bookletInfo.entity';
import { JournalEntry } from '../database/entities/journal-entry.entity';
import { JournalService } from '../database/services/shared/journal.service';
import { WorkspaceFileMetadataService } from '../database/services/workspace/workspace-file-metadata.service';
import { WorkspaceExclusionService } from '../database/services/workspace/workspace-exclusion.service';
import { WorkspacePlayerService } from '../database/services/workspace/workspace-player.service';
import { WorkspaceStatsCacheService } from '../database/services/workspace/workspace-stats-cache.service';
import { WORKSPACE_FILE_METADATA_READER } from '../database/services/workspace/workspace-file-metadata-reader.token';
import { DERIVED_VARIABLE_READER } from '../database/services/workspace/derived-variable-reader.token';

/** Shared workspace reads and cache state; deliberately independent of application workflows. */
@Module({
  imports: [
    CacheClientModule,
    TypeOrmModule.forFeature([FileUpload, Workspace, Persons, ResponseEntity, Unit, Booklet, BookletInfo, JournalEntry])
  ],
  providers: [
    WorkspaceFileMetadataService, WorkspaceExclusionService, WorkspacePlayerService, WorkspaceStatsCacheService, JournalService,
    { provide: WORKSPACE_FILE_METADATA_READER, useExisting: WorkspaceFileMetadataService },
    { provide: DERIVED_VARIABLE_READER, useExisting: WorkspaceFileMetadataService }
  ],
  exports: [
    WorkspaceFileMetadataService, WorkspaceExclusionService, WorkspacePlayerService, WorkspaceStatsCacheService, JournalService,
    WORKSPACE_FILE_METADATA_READER, DERIVED_VARIABLE_READER
  ]
})
export class WorkspaceDataModule {}
