import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  OneToMany
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { Booklet } from './booklet.entity';
// eslint-disable-next-line import/no-cycle
import { UnitLog } from './unitLog.entity';
// eslint-disable-next-line import/no-cycle
import { UnitLastState } from './unitLastState.entity';
// eslint-disable-next-line import/no-cycle
import { Chunk } from './chunk.entity';
// eslint-disable-next-line import/no-cycle
import { Response } from './response.entity';

@Entity('unit')
export class Unit {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ type: 'bigint' })
    bookletId: number;

  @Column({ type: 'text' })
    name: string;

  @Column({ type: 'text', nullable: true })
    alias: string;

  @ManyToOne(() => Booklet, booklet => booklet.units, {
    onDelete: 'CASCADE'
  })
  @JoinColumn({ name: 'bookletId' })
    booklet: Booklet;

  @OneToMany(() => UnitLog, unitLog => unitLog.unit)
    unitLogs: UnitLog[];

  @OneToMany(() => UnitLastState, unitLastState => unitLastState.unit)
    unitLastStates: UnitLastState[];

  @OneToMany(() => Chunk, chunk => chunk.unit)
    chunks: Chunk[];

  @OneToMany(() => Response, response => response.unit)
    responses: Response[];
}
