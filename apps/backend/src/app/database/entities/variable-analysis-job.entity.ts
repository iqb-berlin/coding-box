import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn
} from 'typeorm';

@Entity()
export class VariableAnalysisJob {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
    workspace_id: number;

  @Column({ nullable: true })
    unit_id?: number;

  @Column({ nullable: true })
    variable_id?: string;

  @Column()
    status: string;

  @Column({ nullable: true })
    error?: string;

  @Column({ type: 'text', nullable: true })
    result?: string;

  @CreateDateColumn()
    created_at: Date;

  @UpdateDateColumn()
    updated_at: Date;
}
