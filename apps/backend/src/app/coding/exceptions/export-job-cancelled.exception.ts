export class ExportJobCancelledException extends Error {
  constructor(jobId: string | number) {
    super(`Export job ${jobId} was cancelled`);
    this.name = 'ExportJobCancelledException';
  }
}
