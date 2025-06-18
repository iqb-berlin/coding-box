import {
  Entity, Column, PrimaryGeneratedColumn, Unique
} from 'typeorm';

@Entity('bookletinfo')
@Unique('bookletinfo_pk', ['name'])

export class BookletInfo {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ type: 'text' })
    name: string;

  @Column({ type: 'bigint', default: 0 })
    size: number;
}
