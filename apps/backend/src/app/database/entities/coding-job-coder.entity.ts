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
 * Entity for coding job coders (relation between coding jobs and users)
 */
@Entity({ name: 'coding_job_coder' })
export class CodingJobCoder {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
    coding_job_id: number;

  @Column()
    user_id: number;

  @CreateDateColumn()
    created_at: Date;

  @ManyToOne(() => CodingJob)
  @JoinColumn({ name: 'coding_job_id' })
    coding_job: CodingJob;
}
