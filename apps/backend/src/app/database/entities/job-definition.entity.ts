import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { CodingJob } from './coding-job.entity';
import Workspace from './workspace.entity';
import { MissingsProfile } from './missings-profile.entity';
import type { JobDefinitionRefreshPreviewDto } from '../../../../../../api-dto/coding/job-refresh.dto';

export type JobDefinitionStatus = 'draft' | 'pending_review' | 'approved';
export type CaseOrderingMode = 'continuous' | 'alternating';

export interface JobDefinitionVariable {
  unitName: string;
  variableId: string;
  sampleCount?: number;
  includeDeriveError?: boolean;
}

export interface JobDefinitionVariableBundle {
  id: number;
  name: string;
  variables?: JobDefinitionVariable[];
  sampleCount?: number;
  caseOrderingMode?: CaseOrderingMode;
}

export interface JobDefinitionCoderConfig {
  coderId: number;
  capacityPercent: number;
}

export type JobDefinitionDistributionSnapshotSource = 'initial_creation' | 'refresh';

export interface JobDefinitionDistributionSnapshotCoder {
  coderId: number;
  capacityPercent: number;
}

export interface JobDefinitionDistributionSnapshotJob {
  itemKey?: string;
  coderId: number;
  variable: {
    unitName: string;
    variableId: string;
  };
  jobId: number;
  caseCount: number;
}

export interface JobDefinitionDistributionSnapshotDoubleCodingInfo {
  totalCases: number;
  distinctCases?: number;
  codingTasksTotal?: number;
  doubleCodedCases: number;
  singleCodedCasesAssigned: number;
  doubleCodedCasesPerCoderId: Record<string, number>;
}

export interface JobDefinitionDistributionSnapshot {
  version: 1;
  source: JobDefinitionDistributionSnapshotSource;
  createdAt: string;
  distributionSeed: string;
  selectedVariables: JobDefinitionVariable[];
  selectedVariableBundles: JobDefinitionVariableBundle[];
  selectedCoders: JobDefinitionDistributionSnapshotCoder[];
  settings: {
    maxCodingCases?: number;
    doubleCodingAbsolute?: number;
    doubleCodingPercentage?: number;
    caseOrderingMode?: CaseOrderingMode;
  };
  distributionByCoderId: Record<string, Record<string, number>>;
  doubleCodingInfo: Record<string, JobDefinitionDistributionSnapshotDoubleCodingInfo>;
  aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
  matchingFlags: string[];
  pairDistribution: Record<string, number>;
  tasksPerCoder: Record<string, number>;
  coderWeights: Record<string, number>;
  jobs: JobDefinitionDistributionSnapshotJob[];
  refreshPreview?: JobDefinitionRefreshPreviewDto;
}

@Entity({ name: 'job_definitions' })
export class JobDefinition {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ type: 'int' })
  @Index()
    workspace_id: number;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
    workspace: Workspace;

  @OneToMany(() => CodingJob, codingJob => codingJob.jobDefinition, { cascade: false })
    codingJobs: CodingJob[];

  @Column({ name: 'missings_profile_id', nullable: true })
    missings_profile_id?: number;

  @ManyToOne(() => MissingsProfile)
  @JoinColumn({ name: 'missings_profile_id' })
    missingsProfile?: MissingsProfile;

  @Column({
    type: 'enum',
    enum: [
      'draft',
      'pending_review',
      'approved'
    ],
    default: 'draft'
  })
    status: JobDefinitionStatus;

  @Column({ type: 'jsonb', nullable: true })
    assigned_variables?: JobDefinitionVariable[];

  @Column({ type: 'jsonb', nullable: true })
    assigned_variable_bundles?: JobDefinitionVariableBundle[];

  @Column({ type: 'jsonb', nullable: true })
    assigned_coders?: number[];

  @Column({ type: 'jsonb', nullable: true })
    assigned_coder_configs?: JobDefinitionCoderConfig[];

  @Column({ type: 'jsonb', nullable: true })
    distribution_snapshots?: JobDefinitionDistributionSnapshot[];

  @Column({ type: 'text' })
    distribution_seed?: string;

  @Column({ type: 'int', nullable: true })
    duration_seconds?: number;

  @Column({ type: 'int', nullable: true })
    max_coding_cases?: number;

  @Column({ type: 'int', nullable: true })
    double_coding_absolute?: number;

  @Column({
    type: 'decimal', precision: 5, scale: 2, nullable: true
  })
    double_coding_percentage?: number;

  @Column({
    type: 'enum',
    enum: ['continuous', 'alternating'],
    default: 'continuous'
  })
    case_ordering_mode: CaseOrderingMode;

  @Column({ type: 'boolean', default: false })
    suppress_general_instructions: boolean;

  @Column({ type: 'boolean', default: false })
    show_score: boolean;

  @Column({ type: 'boolean', default: true })
    allow_comments: boolean;

  @CreateDateColumn()
    created_at: Date;

  @UpdateDateColumn()
    updated_at: Date;
}
