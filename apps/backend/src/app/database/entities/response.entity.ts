import {
  Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn
} from 'typeorm';

// eslint-disable-next-line import/no-cycle
import { Unit } from './unit.entity';

@Entity('response')
export class Response {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ type: 'bigint' })
    unitId: number;

  @Column({ type: 'text' })
    variableId: string;

  @Column({ type: 'text' })
    status: string;

  @Column({ type: 'text', nullable: true })
    value: string;

  @Column({ type: 'text', nullable: true })
    subform: string;

  @Column({ type: 'bigint', default: 0 })
    code: number;

  @Column({ type: 'bigint', default: 0 })
    score: number;

  @ManyToOne(() => Unit, unit => unit.responses, {
    onDelete: 'CASCADE'
  })
  @JoinColumn({ name: 'unitId' })
    unit: Unit;
}
