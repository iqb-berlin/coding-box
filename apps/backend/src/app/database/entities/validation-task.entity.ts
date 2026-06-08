import {
  Column,
  ChildEntity
} from 'typeorm';
import { Job } from './job.entity';

export type ValidationType =
  | 'variables'
  | 'variableTypes'
  | 'responseStatus'
  | 'testTakers'
  | 'testFiles'
  | 'groupResponses'
  | 'deleteResponses'
  | 'deleteAllResponses'
  | 'deleteTestResults'
  | 'deleteTestResultResponses'
  | 'deleteTestLogs'
  | 'duplicateResponses';

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
   * - 'testFiles': Validate TestTakers/Booklet/Unit/resource graph completeness
   * - 'groupResponses': Validate if responses exist for all test person groups
   * - 'deleteResponses': Delete specific invalid responses
   * - 'deleteAllResponses': Delete all invalid responses of a specific type
   * - 'deleteTestResults': Delete test result data by selected scope
   * - 'deleteTestResultResponses': Delete response rows by unit, answer time, and optional variable/subform filters
   * - 'deleteTestLogs': Delete test log data by selected scope
   */
  @Column()
    validation_type: ValidationType;

  /**
   * Fingerprint used to reuse completed validation results when inputs are unchanged.
   */
  @Column({
    name: 'cache_key',
    type: 'varchar',
    length: 64,
    nullable: true
  })
    cache_key?: string;

  /**
   * Pagination parameters for paginated results
   */
  @Column({ nullable: true })
    page?: number;

  @Column({ nullable: true })
    limit?: number;
}
