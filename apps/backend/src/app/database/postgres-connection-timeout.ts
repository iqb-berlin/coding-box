/** The pg-pool acquisition and new-connection deadlines use different errors. */
export function isPostgresConnectionTimeout(error: unknown): error is Error {
  return error instanceof Error && [
    'timeout exceeded when trying to connect',
    'Connection terminated due to connection timeout'
  ].includes(error.message);
}
