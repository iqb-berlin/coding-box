import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToMany
} from 'typeorm';
import type { VariableBundle } from './variable-bundle.entity';
import type { CodingJob } from './coding-job.entity';

@Entity('variable')
export class Variable {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ name: 'workspace_id' })
    workspaceId: number;

  @Column({ name: 'unit_name' })
    unitName: string;

  @Column({ name: 'variable_id' })
    variableId: string;

  /**
   * Many-to-many relationship with coding jobs
   * This is the inverse side of the relationship
   */
  @ManyToMany('CodingJob', 'variables')
    codingJobs: CodingJob[];

  /**
   * Many-to-many relationship with variable bundles
   * This is the inverse side of the relationship
   */
  @ManyToMany('VariableBundle', 'variables')
    bundles: VariableBundle[];
}
