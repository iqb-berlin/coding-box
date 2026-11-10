type SettingsAction = 'load' | 'save' | 'delete' | 'connection';

export function testcenterSettingsErrorKey(error: { status?: number; error?: { code?: string; message?: string } }, action: SettingsAction): string {
  const codes: Record<string, string> = {
    TESTCENTER_OPERATOR_MANAGED: 'operator-managed',
    TESTCENTER_INSTANCE_LIMIT: 'instance-limit',
    TESTCENTER_INVALID_INPUT: 'invalid-input',
    TESTCENTER_INVALID_URL: 'invalid-url',
    TESTCENTER_INVALID_VERSION: 'invalid-version',
    TESTCENTER_CONNECTION_TIMEOUT: 'connection-timeout',
    TESTCENTER_CERTIFICATE_ERROR: 'certificate-error',
    TESTCENTER_CONNECTION_FAILED: 'connection-failed'
  };
  const detail = codes[error.error?.code || ''];
  if (detail) return `ui-text.testcenter-instances.errors.${detail}`;
  if (error.status === 401) return 'ui-text.testcenter-instances.login-error.session-expired';
  if (error.status === 403) {
    return error.error?.message === 'Testcenter target is not allowed' ?
      'ui-text.testcenter-instances.errors.no-longer-approved' : 'ui-text.testcenter-instances.errors.admin-required';
  }
  if (error.status === 0) return 'ui-text.testcenter-instances.errors.backend-unavailable';
  return `ui-text.testcenter-instances.${action === 'connection' ? 'connection' : action}-failed`;
}
