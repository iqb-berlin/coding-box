import { JournalEntry } from './journal-entry.model';

export interface PaginatedJournalEntries {
  entries: JournalEntry[];
  total: number;
}
