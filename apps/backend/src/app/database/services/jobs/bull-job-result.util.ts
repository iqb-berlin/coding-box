import type { Job } from 'bullmq';
import type { CodingStatistics } from '../shared';

export function mapJobStateToStatus(state: string): 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused' {
  switch (state) {
    case 'active': return 'processing';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'paused': return 'paused';
    default: return 'pending';
  }
}

export function extractJobResult<T>(bullJob: Job<T>, state: string): { result?: CodingStatistics; error?: string } {
  let result: CodingStatistics | undefined;
  let error: string | undefined;
  if (state === 'completed' && bullJob.returnvalue) result = bullJob.returnvalue as CodingStatistics;
  else if (state === 'failed' && bullJob.failedReason) error = bullJob.failedReason;
  return { result, error };
}
