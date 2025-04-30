import {
  Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn
} from 'typeorm';

// eslint-disable-next-line import/no-cycle
import { Booklet } from './booklet.entity';

@Entity('session')
export class Session {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ type: 'text', nullable: true })
    browser: string;

  @Column({ type: 'text', nullable: true })
    os: string;

  @Column({ type: 'text', nullable: true })
    screen: string;

  @Column({ type: 'bigint', nullable: true })
    ts: number;

  @Column({ type: 'bigint', nullable: true })
    loadCompleteMS: number;

  @ManyToOne(() => Booklet, booklet => booklet.sessions, {
    onDelete: 'CASCADE'
  })
  @JoinColumn({ name: 'bookletId' })
    booklet: Booklet;
}
