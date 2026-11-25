import type { TestResultsUploadPhase } from '../../../../../../api-dto/files/test-results-upload-progress.dto';
import type { TestResultsUploadResultDto } from '../../../../../../api-dto/files/test-results-upload-result.dto';

export type UploadJobStatus = {
  id?: string;
  status: 'completed' | 'waiting' | 'active' | 'delayed' | 'failed' | 'paused' | 'poll-error';
  progress: number;
  phase?: TestResultsUploadPhase;
  result?: TestResultsUploadResultDto;
  error?: unknown;
};

export function summarizeUploadProgress(statuses: UploadJobStatus[]) {
  const totalJobs = statuses.length;
  const active = statuses.filter(status => status.status === 'active');
  const phase: TestResultsUploadPhase = active.length > 0 && active.every(status => status.phase === 'reading') ?
    'reading' : 'processing';
  let totalProgress = 0;
  let completedCount = 0;
  for (const status of statuses) {
    if (status.status === 'completed' || status.status === 'failed') {
      completedCount += 1;
      totalProgress += 100;
    } else {
      totalProgress += status.progress;
    }
  }
  return {
    phase,
    avgProgress: totalJobs > 0 ? Math.floor(totalProgress / totalJobs) : 0,
    completedCount,
    totalJobs
  };
}
