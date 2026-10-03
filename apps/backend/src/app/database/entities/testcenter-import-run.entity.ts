import {
  Column, Entity, JoinColumn, ManyToOne, PrimaryColumn
} from 'typeorm';
import type { ImportWorkspaceFilesProgressDto } from '../../../../../../api-dto/files/import-workspace-progress.dto';
import Workspace from './workspace.entity';

@Entity('testcenter_import_run')
export class TestcenterImportRun {
  @PrimaryColumn({ type: 'int' })
    workspace_id!: number;

  @PrimaryColumn({ type: 'varchar', length: 128 })
    import_run_id!: string;

  @Column({ type: 'jsonb' })
    progress!: ImportWorkspaceFilesProgressDto;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
    workspace!: Workspace;
}
