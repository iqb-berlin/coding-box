export interface ProcessDto {
  id: string | number;
  queueName: string;
  status: 'active' | 'waiting' | 'delayed' | 'completed' | 'failed' | 'paused' | 'unknown';
  progress: number | unknown;
  data: unknown; // Omitted or sanitized job data payload
  failedReason?: string;
  timestamp: number;
  processedOn?: number; // When started
  finishedOn?: number; // When finished
}
