export interface CodingJob {
  id: number;
  name: string;
  description?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  assignedCoders: number[];
}
