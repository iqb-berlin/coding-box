import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn
} from 'typeorm';

/**
 * Entity for variable bundles
 * A variable bundle is a collection of variables that can be used together
 */
@Entity({ name: 'variable_bundle' })
export class VariableBundle {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
    workspace_id: number;

  @Column()
    name: string;

  @Column({ type: 'text', nullable: true })
    description?: string;

  /**
   * Array of variables in the bundle
   * Each variable has a unitName and variableId
   * Stored as a JSON array
   */
  @Column({ type: 'jsonb' })
    variables: Array<{ unitName: string; variableId: string }>;

  @CreateDateColumn()
    created_at: Date;

  @UpdateDateColumn()
    updated_at: Date;
}
