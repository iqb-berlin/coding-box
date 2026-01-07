import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn
} from 'typeorm';
import { CodingJob } from './coding-job.entity';

/**
 * Entity for coding job variables (relation between coding jobs and variables)
 */
@Entity({ name: 'coding_job_variable' })
export class CodingJobVariable {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
    coding_job_id: number;

  @Column()
    unit_name: string;

  @Column()
    variable_id: string;

  @CreateDateColumn()
    created_at: Date;

  @ManyToOne(() => CodingJob)
  @JoinColumn({ name: 'coding_job_id' })
    coding_job: CodingJob;
}
