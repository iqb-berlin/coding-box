import {
  Entity, Column, ManyToOne, JoinColumn, PrimaryGeneratedColumn
} from 'typeorm';
import type { Relation } from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { Unit } from './unit.entity';

@Entity('unitlaststate')
export class UnitLastState {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'bigint' })
  unitid: number;

  @Column({ type: 'text' })
  key: string;

  @Column({ type: 'text', nullable: true })
  value: string;

  @ManyToOne(() => Unit, unit => unit.unitLastStates, {
    onDelete: 'CASCADE'
  })
  @JoinColumn({ name: 'unitid' })
  unit: Relation<Unit>;
}
