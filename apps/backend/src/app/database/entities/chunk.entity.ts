import {
  Entity, Column, ManyToOne, JoinColumn, PrimaryColumn
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { Unit } from './unit.entity';

@Entity('chunk')
export class ChunkEntity {
  @PrimaryColumn({ type: 'bigint' })
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
    unit: Unit;
}
