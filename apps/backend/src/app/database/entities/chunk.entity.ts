import {
  Entity, Column, ManyToOne, JoinColumn, PrimaryGeneratedColumn
} from 'typeorm';
import type { Relation } from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { Unit } from './unit.entity';

@Entity('chunk')
export class ChunkEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'bigint' })
  unitid: number;

  @Column({ type: 'text' })
  key: string;

  @Column({ type: 'text', nullable: true })
  type: string;

  @Column({ type: 'text', nullable: true })
  variables: string;

  @Column({ type: 'bigint', nullable: true })
  ts: number;

  @ManyToOne(() => Unit, unit => unit.chunks, {
    onDelete: 'CASCADE'
  })
  @JoinColumn({ name: 'unitid' })
  unit: Relation<Unit>;
}
