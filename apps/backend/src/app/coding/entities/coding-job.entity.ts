import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { CoderTraining } from './coder-training.entity';
import { MissingsProfile } from '../../workspaces/entities/missings-profile.entity';
// eslint-disable-next-line import/no-cycle
import { CodingJobUnit } from './coding-job-unit.entity';
// eslint-disable-next-line import/no-cycle
import { CodingJobCoder } from './coding-job-coder.entity';
// eslint-disable-next-line import/no-cycle
import { JobDefinition, CaseOrderingMode } from './job-definition.entity';
// eslint-disable-next-line import/no-cycle
import { CodingJobVariableBundle } from './coding-job-variable-bundle.entity';

export interface Variable {
  unitName: string;
  variableId: string;
}

/**
 * Entity for coding jobs
 * A coding job is a collection of variables and variable bundles assigned to coders
 */
@Entity({ name: 'coding_job' })
export class CodingJob {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
    workspace_id: number;

  @Column()
    name: string;

  @Column({ type: 'text', nullable: true })
    description?: string;

  @Column({ type: 'text', nullable: true })
    comment?: string;

  @Column({ default: 'pending' })
    status: string;

  @Column({ name: 'show_score', default: false })
    showScore: boolean;

  @Column({ name: 'allow_comments', default: true })
    allowComments: boolean;

  @Column({ name: 'suppress_general_instructions', default: false })
    suppressGeneralInstructions: boolean;

  @Column({ nullable: true })
    training_id?: number;

  @ManyToOne(() => CoderTraining, coderTraining => coderTraining.codingJobs)
  @JoinColumn({ name: 'training_id' })
    training?: CoderTraining;

  @Column({ name: 'missings_profile_id', nullable: true })
    missings_profile_id?: number;

  @ManyToOne(() => MissingsProfile)
  @JoinColumn({ name: 'missings_profile_id' })
    missingsProfile?: MissingsProfile;

  @Column({ name: 'job_definition_id', nullable: true })
    job_definition_id?: number;

  @ManyToOne(() => JobDefinition, jobDefinition => jobDefinition.codingJobs, { nullable: true })
  @JoinColumn({ name: 'job_definition_id' })
    jobDefinition?: JobDefinition;

  @Column({
    name: 'case_ordering_mode',
    type: 'varchar',
    length: 20,
    enum: ['continuous', 'alternating'],
    default: 'continuous'
  })
    case_ordering_mode: CaseOrderingMode;

  @CreateDateColumn()
    created_at: Date;

  @UpdateDateColumn()
    updated_at: Date;

  @OneToMany(() => CodingJobUnit, codingJobUnit => codingJobUnit.coding_job, { cascade: true })
    codingJobUnits: CodingJobUnit[];

  @OneToMany(() => CodingJobCoder, codingJobCoder => codingJobCoder.coding_job, { cascade: true })
    codingJobCoders: CodingJobCoder[];

  @OneToMany(() => CodingJobVariableBundle, codingJobVariableBundle => codingJobVariableBundle.coding_job, { cascade: true })
    codingJobVariableBundles: CodingJobVariableBundle[];
}
