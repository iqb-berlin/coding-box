export interface AdminUser {
  id: number;
  username: string;
  displayName?: string;
  email?: string;
  isAdmin: boolean;
  lastLogin?: Date;
}
