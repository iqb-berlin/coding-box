import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class FlatResponseFilterPurgeStore {
  constructor(private readonly db: DataSource) {}

  async pendingEvent(workspaceId: number): Promise<number | undefined> {
    const rows: { deletion_event_id: number }[] = await this.db.query(
      'SELECT deletion_event_id FROM public.flat_response_filter_purge WHERE workspace_id = $1', [workspaceId]
    );
    return rows[0]?.deletion_event_id;
  }

  async pendingWorkspaces(): Promise<number[]> {
    const rows: { workspace_id: number }[] = await this.db.query(
      'SELECT workspace_id FROM public.flat_response_filter_purge ORDER BY workspace_id'
    );
    return rows.map(row => row.workspace_id);
  }

  async complete(workspaceId: number, eventId: number): Promise<void> {
    // A deletion committed during the Redis scan needs its own purge.
    await this.db.query(
      'DELETE FROM public.flat_response_filter_purge WHERE workspace_id = $1 AND deletion_event_id = $2',
      [workspaceId, eventId]
    );
  }
}
