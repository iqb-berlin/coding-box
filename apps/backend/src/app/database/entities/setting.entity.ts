import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Entity for storing application settings
 *
 * This entity uses a key-value pattern where:
 * - key: A string that serves as the primary key (e.g., 'missings-profile-iqb-standard')
 * - content: A string field that stores JSON data
 */
@Entity()
export class Setting {
  @PrimaryColumn()
    key: string;

  @Column('text')
    content: string;
}
