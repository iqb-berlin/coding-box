import {
  Entity, Column, PrimaryGeneratedColumn, OneToMany
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { Booklet } from './booklet.entity';

@Entity('person')
export class Person {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ type: 'text' })
    group: string;

  @Column({ type: 'text' })
    login: string;

  @Column({ type: 'text', nullable: true })
    code: string;

  @OneToMany(() => Booklet, booklet => booklet.person)
    booklets: Booklet[];
}
