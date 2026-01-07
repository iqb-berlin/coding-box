import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { CodingJob } from './coding-job.entity';
// eslint-disable-next-line import/no-cycle
import { ResponseEntity } from '../../database/entities/response.entity';

/**
 * Entity for coding job units (responses that need to be coded for a job)
 */
@Entity({ name: 'coding_job_unit' })
export class CodingJobUnit {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
    coding_job_id: number;

  @Index()
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

  @Column()
    person_group: string;

  @Column({ nullable: true })
    code: number | null;

  @Column({ nullable: true })
    score: number | null;

  @Column({ default: false })
    is_open: boolean;

  @Column({ nullable: true, type: 'text' })
    notes: string | null;

  @Column({ nullable: true })
    coding_issue_option: number | null;

  @CreateDateColumn()
    created_at: Date;

  @UpdateDateColumn()
    updated_at: Date;

  @ManyToOne(() => CodingJob)
  @JoinColumn({ name: 'coding_job_id' })
    coding_job: CodingJob;

  @ManyToOne(() => ResponseEntity)
  @JoinColumn({ name: 'response_id' })
    response: ResponseEntity;
}
