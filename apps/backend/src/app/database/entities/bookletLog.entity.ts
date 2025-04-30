import {
  Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { Booklet } from './booklet.entity';

@Entity('bookletLog')
export class BookletLog {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ type: 'bigint' })
    bookletId: number;

  @Column({ type: 'text' })
    key: string;

  @Column({ type: 'text', nullable: true })
    parameter: string;

  @Column({ type: 'bigint', nullable: true })
    ts: number;

  @ManyToOne(() => Booklet, booklet => booklet.bookletLogs, {
    onDelete: 'CASCADE'
  })
  @JoinColumn({ name: 'bookletId' })
    booklet: Booklet;
}
