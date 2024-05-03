import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
class User {
  @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

  @Column({ type: 'varchar' })
    identity: string;

  @Column({ type: 'varchar' })
    issuer: string;

  @Column({ type: 'boolean' })
    isAdmin: boolean;

  @Column({ type: 'varchar' })
    username: string;

  @Column({
    name: 'last_name', type: 'varchar'
  })
    lastName: string | null;

  @Column({
    name: 'first_name', type: 'varchar'
  })
    firstName: string | null;

  @Column({ type: 'varchar' })
    email: string | null;
}

export default User;
