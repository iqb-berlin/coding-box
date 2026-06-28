export const EXPORT_WORKER_ROLE = 'export-worker';

export function isExportWorkerProcess(): boolean {
  return process.env.APP_ROLE === EXPORT_WORKER_ROLE;
}
