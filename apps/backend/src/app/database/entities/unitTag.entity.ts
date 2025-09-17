import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { Unit } from './unit.entity';

@Entity('unit_tag')
@Index(['unitId', 'tag']) // Composite index for common query patterns
export class UnitTag {
  @PrimaryGeneratedColumn()
    id: number;

  @Index()
  @Column({ type: 'bigint' })
    unitId: number;

  @Index()
  @Column({ type: 'text' })
    tag: string;

  @Column({ type: 'text', nullable: true })
    color: string;

  @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

  @ManyToOne(() => Unit, unit => unit.tags, {
    onDelete: 'CASCADE'
  })
  @JoinColumn({ name: 'unitId' })
    unit: Unit;
}
