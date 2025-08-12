import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn
} from 'typeorm';
import { CodingJob } from './coding-job.entity';
import { VariableBundle } from './variable-bundle.entity';

/**
 * Entity for coding job variable bundles (relation between coding jobs and variable bundles)
 */
@Entity({ name: 'coding_job_variable_bundle' })
export class CodingJobVariableBundle {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
    coding_job_id: number;

  @Column()
    variable_bundle_id: number;

  @CreateDateColumn()
    created_at: Date;

  @ManyToOne(() => CodingJob)
  @JoinColumn({ name: 'coding_job_id' })
    coding_job: CodingJob;

  @ManyToOne(() => VariableBundle)
  @JoinColumn({ name: 'variable_bundle_id' })
    variable_bundle: VariableBundle;
}
