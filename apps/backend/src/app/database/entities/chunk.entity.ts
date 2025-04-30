import {
  Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { Unit } from './unit.entity';

@Entity('chunk')
export class Chunk {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ type: 'bigint' })
    unitId: number;

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
  @JoinColumn({ name: 'unitId' })
    unit: Unit;
}
