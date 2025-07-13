export interface JournalEntry {
  id: number;
  timestamp: Date;
  level: string;
  message: string;
  details?: unknown;
}
