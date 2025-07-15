import {
  Column,
  ChildEntity
} from 'typeorm';
import { Job } from './job.entity';

/**
 * Entity for test person coding jobs
 */
@ChildEntity('test-person-coding')
export class TestPersonCodingJob extends Job {
  /**
   * Comma-separated list of person IDs to code
   */
  @Column({ type: 'text', nullable: true })
    person_ids?: string;

  /**
   * Comma-separated list of group names that were coded
   */
  @Column({ type: 'text', nullable: true })
    group_names?: string;

  /**
   * Time in milliseconds that the job took to complete
   * Only set when the job is completed
   */
  @Column({ type: 'bigint', nullable: true })
    duration_ms?: number;
}
