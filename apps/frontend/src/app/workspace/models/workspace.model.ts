export interface Workspace {
  id: number;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  ownerId: number;
}
