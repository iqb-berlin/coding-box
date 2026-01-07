import {
  Column,
  ChildEntity
} from 'typeorm';
import { Job } from '../../common';

/**
 * Entity for test person coding jobs
 *
 * NOTE: This entity is no longer actively used in the codebase as of 2025-07-28.
 * Job management has been transitioned to use Bull queue directly.
 * This entity is kept for database compatibility and historical data.
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
