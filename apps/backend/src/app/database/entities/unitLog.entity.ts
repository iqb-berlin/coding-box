import {
  Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { Unit } from './unit.entity';

@Entity('unitlog')
export class UnitLog {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ type: 'bigint' })
    unitid: number;

  @Column({ type: 'text' })
    key: string;

  @Column({ type: 'text', nullable: true })
    parameter: string;

  @Column({ type: 'bigint', nullable: true })
    ts: number;

  @ManyToOne(() => Unit, unit => unit.unitLogs, {
    onDelete: 'CASCADE'
  })
  @JoinColumn({ name: 'unitid' })
    unit: Unit;
}
