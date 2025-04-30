import {
  Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { Unit } from './unit.entity';

@Entity('unitLastState')
export class UnitLastState {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ type: 'bigint' })
    unitId: number;

  @Column({ type: 'text' })
    key: string;

  @Column({ type: 'text', nullable: true })
    value: string;

  @ManyToOne(() => Unit, unit => unit.unitLastStates, {
    onDelete: 'CASCADE'
  })
  @JoinColumn({ name: 'unitId' })
    unit: Unit;
}
