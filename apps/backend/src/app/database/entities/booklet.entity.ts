import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  OneToMany
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { Person } from './person.entity';
import { BookletInfo } from './bookletInfo.entity';
// eslint-disable-next-line import/no-cycle
import { BookletLog } from './bookletLog.entity';
// eslint-disable-next-line import/no-cycle
import { Unit } from './unit.entity';
// eslint-disable-next-line import/no-cycle
import { Session } from './session.entity';

@Entity('booklet')
export class Booklet {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ type: 'bigint' })
    infoid: number;

  @Column({ type: 'bigint' })
    personid: number;

  @Column({ type: 'bigint', default: 0 })
    lastts: number;

  @Column({ type: 'bigint', default: 0 })
    firstts: number;

  @ManyToOne(() => Person, person => person.booklets, {
    onDelete: 'CASCADE'
  })
  @JoinColumn({ name: 'personid' })
    person: Person;

  @ManyToOne(() => BookletInfo, {
    onDelete: 'CASCADE'
  })
  @JoinColumn({ name: 'infoid' })
    bookletinfo: BookletInfo;

  @OneToMany(() => Session, session => session.booklet)
    sessions: Session[];

  @OneToMany(() => BookletLog, bookletLog => bookletLog.booklet)
    bookletLogs: BookletLog[];

  @OneToMany(() => Unit, unit => unit.booklet)
    units: Unit[];
}
