import type { TestcenterInstanceDto } from '../../../../../../../api-dto/testcenter/testcenter-instance.dto';
import type { Testcenter } from '../../../shared/models/test-center-authentication.model';

export function testcenterChoices(instances: TestcenterInstanceDto[], translate: (key: string) => string): Testcenter[] {
  const labels = [
    'ui-text.test-center-import.instance-1', 'ui-text.test-center-import.instance-2', 'ui-text.test-center-import.instance-3',
    'ui-text.test-center-import.instance-4', 'ui-text.test-center-import.instance-5'
  ];
  return [
    ...labels.map((label, index) => ({ id: index + 1, label: translate(label) })),
    ...instances.filter(instance => !/^https:\/\/iqb-testcenter[1-5]\.de$/.test(instance.baseUrl))
      .map((instance, index) => ({ id: index + 7, label: instance.label, url: instance.baseUrl }))
  ];
}

export function testcenterLoginErrorKey(error: { status?: number; error?: { message?: string } }): string {
  if (error.error?.message === 'Testcenter target is not allowed') return 'ui-text.testcenter-instances.login-error.not-approved';
  const keys: Record<number, string> = {
    0: 'unavailable',
    400: 'rejected',
    401: 'session-expired',
    403: 'access-denied',
    422: 'credentials',
    429: 'rate-limited',
    502: 'unsupported',
    503: 'unavailable',
    504: 'timeout'
  };
  return `ui-text.testcenter-instances.login-error.${keys[error.status || 0] || 'rejected'}`;
}
