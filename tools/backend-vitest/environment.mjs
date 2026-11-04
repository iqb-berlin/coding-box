/** Ordinary unit runs stay offline unless a caller explicitly enables a test fixture. */
export function backendTestEnvironment(options, environment) {
  const env = {
    ...environment,
    BACKEND_VITEST_SCOPE: options.scope,
    BACKEND_VITEST_FILTERED: options.filter || options.testPathPatterns?.length ? 'true' : 'false',
    BACKEND_VITEST_TEST_PATH_PATTERNS: JSON.stringify(options.testPathPatterns || []),
    POSTGRES_INTEGRATION_TESTS: environment.POSTGRES_INTEGRATION_TESTS || 'false',
    WORKSPACE_DELETION_TEST_DATABASE_URL: environment.WORKSPACE_DELETION_TEST_DATABASE_URL || ''
  };
  if (options.workers) env.BACKEND_VITEST_WORKERS = String(options.workers);
  if (env.POSTGRES_INTEGRATION_TESTS !== 'true' && !env.WORKSPACE_DELETION_TEST_DATABASE_URL) {
    delete env.REDIS_HOST;
    delete env.REDIS_PORT;
    delete env.REDIS_PREFIX;
  }
  return env;
}
