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
 * Entity for coding job units (responses that need to be coded for a job)
 */
@Entity({ name: 'coding_job_unit' })
export class CodingJobUnit {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
    coding_job_id: number;

  @Column()
    response_id: number;

  @Column()
    unit_name: string;

  @Column({ nullable: true })
    unit_alias: string | null;

  @Column()
    variable_id: string;

  @Column()
    variable_anchor: string;

  @Column()
    booklet_name: string;

  @Column()
    person_login: string;

  @Column()
    person_code: string;

  @Column({ nullable: true })
    code: number | null;

  @Column({ nullable: true })
    score: number | null;

  @CreateDateColumn()
    created_at: Date;

  @ManyToOne(() => CodingJob)
  @JoinColumn({ name: 'coding_job_id' })
    coding_job: CodingJob;
}
