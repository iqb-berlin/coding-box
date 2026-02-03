import {
  Entity, Column, ManyToOne, JoinColumn, PrimaryGeneratedColumn, Index
} from 'typeorm';

// eslint-disable-next-line import/no-cycle
import { Unit } from './unit.entity';

@Entity('response')
@Index(['unitid', 'variableid']) // Composite index for common query patterns
@Index(['unitid', 'status']) // Composite index for filtering by status
@Index(['status_v1']) // Index for filtering by coded status
export class ResponseEntity {
  @PrimaryGeneratedColumn()
    id: number;

  @Index()
  @Column({ type: 'int' })
    unitid: number;

  @Index()
  @Column({ type: 'varchar', length: 255 })
    variableid: string;

  @Column({ type: 'smallint' })
    status: number;

  @Column({ type: 'text', nullable: true })
    value: string;

  @Column({ type: 'text', nullable: true })
    subform: string;

  @Column({ type: 'smallint', nullable: true })
    status_v1: number | null;

  @Column({ type: 'bigint', nullable: true })
    code_v1: number | null;

  @Column({ type: 'smallint', nullable: true })
    score_v1: number | null;

  @Column({ type: 'smallint', nullable: true })
    status_v2: number | null;

  @Column({ type: 'bigint', nullable: true })
    code_v2: number | null;

  @Column({ type: 'bigint', nullable: true })
    score_v2: number | null;

  @Column({ type: 'smallint', nullable: true })
    status_v3: number | null;

  @Column({ type: 'bigint', nullable: true })
    code_v3: number | null;

  @Column({ type: 'bigint', nullable: true })
    score_v3: number | null;

  @ManyToOne(() => Unit, unit => unit.responses, {
    onDelete: 'CASCADE'
    // Not using eager loading here to avoid performance issues with large result sets
  })
  @JoinColumn({ name: 'unitid' })
    unit: Unit;
}
