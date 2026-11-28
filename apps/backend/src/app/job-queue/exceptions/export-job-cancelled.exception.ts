export class ExportJobCancelledException extends Error {
  constructor(jobId: string | number) {
    super(`Export job ${jobId} was cancelled`);
    this.name = 'ExportJobCancelledException';
  }
}

export function isCancelledExport(state: string, job: { data?: { isCancelled?: boolean }; failedReason?: string }): boolean {
  if (job.data?.isCancelled && ['waiting', 'prioritized', 'delayed', 'active', 'completed', 'failed'].includes(state)) return true;
  const reason = job.failedReason || '';
  return state === 'failed' && (reason.includes('ExportJobCancelledException') || /^Export job .* was cancelled$/.test(reason));
}
