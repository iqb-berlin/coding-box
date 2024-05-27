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
}

export default User;
