import {
  Entity, Column, ManyToOne, JoinColumn, PrimaryGeneratedColumn, Index
} from 'typeorm';

// eslint-disable-next-line import/no-cycle
import { Unit } from './unit.entity';

@Entity('response')
@Index(['unitid', 'variableid']) // Composite index for common query patterns
@Index(['unitid', 'status']) // Composite index for filtering by status
@Index(['codedstatus']) // Index for filtering by coded status
@Index(['value']) // Index for searching by value
export class ResponseEntity {
  @PrimaryGeneratedColumn()
    id: number;

  @Index()
  @Column({ type: 'bigint' })
    unitid: number;

  @Index()
  @Column({ type: 'text' })
    variableid: string;

  @Column({ type: 'text' })
    status: string;

  @Column({ type: 'text', nullable: true })
    value: string;

  @Column({ type: 'text', nullable: true })
    subform: string;

  @Column({ type: 'bigint', nullable: true })
    code: number | null;

  @Column({ type: 'bigint', nullable: true })
    score: number | null;

  @Column({ type: 'text' })
    codedstatus: string;

  @Column({ type: 'text', nullable: true })
    status_v2: string | null;

  @Column({ type: 'bigint', nullable: true })
    code_v2: number | null;

  @Column({ type: 'bigint', nullable: true })
    score_v2: number | null;

  @Column({ type: 'text', nullable: true })
    status_v3: string | null;

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
