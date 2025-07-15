import {
  Column,
  ChildEntity
} from 'typeorm';
import { Job } from './job.entity';

/**
 * Entity for variable analysis jobs
 */
@ChildEntity('variable-analysis')
export class VariableAnalysisJob extends Job {
  /**
   * Optional unit ID to filter by
   */
  @Column({ nullable: true })
    unit_id?: number;

  /**
   * Optional variable ID to filter by
   */
  @Column({ nullable: true })
    variable_id?: string;
}
