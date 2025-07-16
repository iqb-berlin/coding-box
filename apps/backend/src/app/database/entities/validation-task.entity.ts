import {
  Column,
  ChildEntity
} from 'typeorm';
import { Job } from './job.entity';

/**
 * Entity for validation tasks
 */
@ChildEntity('validation-task')
export class ValidationTask extends Job {
  /**
   * Type of validation to perform
   * - 'variables': Validate if variables are defined in the Unit.xml
   * - 'variableTypes': Validate if variable values match their defined types
   * - 'responseStatus': Validate if response status is valid
   * - 'testTakers': Validate if test takers exist in TestTakers XML files
   * - 'groupResponses': Validate if responses exist for all test person groups
   * - 'deleteResponses': Delete specific invalid responses
   * - 'deleteAllResponses': Delete all invalid responses of a specific type
   */
  @Column()
    validation_type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'deleteResponses' | 'deleteAllResponses';

  /**
   * Pagination parameters for paginated results
   */
  @Column({ nullable: true })
    page?: number;

  @Column({ nullable: true })
    limit?: number;
}
