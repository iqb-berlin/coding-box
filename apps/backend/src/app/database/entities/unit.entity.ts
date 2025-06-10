import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { Booklet } from './booklet.entity';
// eslint-disable-next-line import/no-cycle
import { UnitLog } from './unitLog.entity';
// eslint-disable-next-line import/no-cycle
import { UnitLastState } from './unitLastState.entity';
// eslint-disable-next-line import/no-cycle
import { ChunkEntity } from './chunk.entity';
// eslint-disable-next-line import/no-cycle
import { ResponseEntity } from './response.entity';
// eslint-disable-next-line import/no-cycle
import { UnitTag } from './unitTag.entity';
// eslint-disable-next-line import/no-cycle
import { UnitNote } from './unitNote.entity';

@Entity('unit')
@Index(['bookletid', 'alias']) // Composite index for common query patterns
export class Unit {
  @PrimaryGeneratedColumn()
    id: number;

  @Index()
  @Column({ type: 'bigint' })
    bookletid: number;

  @Index()
  @Column({ type: 'text' })
    name: string;

  @Index()
  @Column({ type: 'text', nullable: true })
    alias: string;

  @ManyToOne(() => Booklet, booklet => booklet.units, {
    onDelete: 'CASCADE'
    // Not using eager loading here to avoid circular eager loading with Booklet
  })
  @JoinColumn({ name: 'bookletid' })
    booklet: Booklet;

  @OneToMany(() => UnitLog, unitLog => unitLog.unit, {
    // Cascade operations to unit logs when unit is modified
    cascade: true
  })
    unitLogs: UnitLog[];

  @OneToMany(() => UnitLastState, unitLastState => unitLastState.unit, {
    // Cascade operations to unit last states when unit is modified
    cascade: true
  })
    unitLastStates: UnitLastState[];

  @OneToMany(() => ChunkEntity, chunk => chunk.unit, {
    // Cascade operations to chunks when unit is modified
    cascade: true
  })
    chunks: ChunkEntity[];

  @OneToMany(() => ResponseEntity, response => response.unit, {
    // Cascade operations to responses when unit is modified
    cascade: true
  })
    responses: ResponseEntity[];

  @OneToMany(() => UnitTag, unitTag => unitTag.unit, {
    // Cascade operations to unit tags when unit is modified
    cascade: true
  })
    tags: UnitTag[];

  @OneToMany(() => UnitNote, unitNote => unitNote.unit, {
    // Cascade operations to unit notes when unit is modified
    cascade: true
  })
    notes: UnitNote[];
}
