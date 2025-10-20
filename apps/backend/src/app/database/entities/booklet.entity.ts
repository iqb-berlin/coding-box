import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index
} from 'typeorm';

import { BookletInfo } from './bookletInfo.entity';
// eslint-disable-next-line import/no-cycle
import { BookletLog } from './bookletLog.entity';
// eslint-disable-next-line import/no-cycle
import { Unit } from './unit.entity';
// eslint-disable-next-line import/no-cycle
import { Session } from './session.entity';
// eslint-disable-next-line import/no-cycle
import Persons from './persons.entity';

@Entity('booklet')
@Index(['personid', 'infoid']) // Composite index for common query patterns
export class Booklet {
  @PrimaryGeneratedColumn()
    id: number;

  @Index()
  @Column({ type: 'int' })
    infoid: number;

  @Index()
  @Column({ type: 'int' })
    personid: number;

  @Column({ type: 'bigint', default: 0 })
    lastts: number;

  @Column({ type: 'bigint', default: 0 })
    firstts: number;

  @ManyToOne(() => Persons, person => person.booklets, {
    onDelete: 'CASCADE',
    // Eager loading for person as it's frequently accessed with booklet
    eager: true
  })
  @JoinColumn({ name: 'personid' })
    person: Persons;

  @ManyToOne(() => BookletInfo, {
    onDelete: 'CASCADE',
    // Eager loading for bookletinfo as it's frequently accessed with booklet
    eager: true
  })
  @JoinColumn({ name: 'infoid' })
    bookletinfo: BookletInfo;

  @OneToMany(() => Session, session => session.booklet)
    sessions: Session[];

  @OneToMany(() => BookletLog, bookletLog => bookletLog.booklet)
    bookletLogs: BookletLog[];

  @OneToMany(() => Unit, unit => unit.booklet, {
    // Cascade operations to units when booklet is modified
    cascade: true
  })
    units: Unit[];
}
