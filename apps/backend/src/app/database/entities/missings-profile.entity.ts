import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Entity for storing missings profiles dedicated table
 *
 * This entity replaces the previous storage in the settings table
 * and stores missings profiles with their configuration in JSON format.
 */
@Entity('missings_profile')
export class MissingsProfile {
  @PrimaryGeneratedColumn()
    id: number;

  @Column('varchar', { length: 255, unique: true })
    label: string;

  @Column('text')
    missings: string;
}
