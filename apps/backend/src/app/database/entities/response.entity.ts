import {
  Entity, Column, ManyToOne, JoinColumn, PrimaryGeneratedColumn, Index
} from 'typeorm';

// eslint-disable-next-line import/no-cycle
import { Unit } from './unit.entity';

@Entity('response')
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

  @Column({ type: 'bigint', default: 0 })
    code: number;

  @Column({ type: 'bigint', default: 0 })
    score: number;

  @ManyToOne(() => Unit, unit => unit.responses, {
    onDelete: 'CASCADE'
  })
  @JoinColumn({ name: 'unitid' })
    unit: Unit;
}
