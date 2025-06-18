import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn
} from 'typeorm';

@Entity()
class User {
  @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

  @Index()
  @Column({ type: 'varchar' })
    identity: string;

  @Column({ type: 'varchar' })
    issuer: string;

  @Column({ type: 'boolean' })
    isAdmin: boolean;

  @Column({ type: 'varchar' })
    username: string;
}

export default User;
