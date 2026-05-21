export class DatabaseExportCancelledError extends Error {
  constructor() {
    super('Database export was cancelled.');
  }
}
