import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { Unit } from './unit.entity';
import {
  CodingFreshnessReason,
  CodingFreshnessState,
  CodingFreshnessVersion
} from '../../../../../../api-dto/coding/coding-freshness.dto';

@Entity('coding_unit_freshness')
@Index(['workspace_id', 'unit_id', 'version'], { unique: true })
@Index(['workspace_id', 'state'])
@Index(['workspace_id', 'version', 'state'])
export class CodingUnitFreshness {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ type: 'int' })
    workspace_id: number;

  @Column({ type: 'int' })
    unit_id: number;

  @Column({ type: 'varchar', length: 2 })
    version: CodingFreshnessVersion;

  @Column({ type: 'varchar', length: 32 })
    state: CodingFreshnessState;

  @Column({ type: 'varchar', length: 32 })
    reason: CodingFreshnessReason;

  @Column({ type: 'int', default: 0 })
    affected_response_count: number;

  @Column({ type: 'int', default: 0 })
    source_revision: number;

  @Column({ type: 'int', nullable: true })
    coded_revision: number | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
    created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
    updated_at: Date;

  @ManyToOne(() => Unit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'unit_id' })
    unit: Unit;
}
