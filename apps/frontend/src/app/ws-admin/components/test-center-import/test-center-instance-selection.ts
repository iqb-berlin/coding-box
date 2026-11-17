import type { TestcenterInstanceDto } from '../../../../../../../api-dto/testcenter/testcenter-instance.dto';
import type { Testcenter } from '../../../shared/models/test-center-authentication.model';

export function testcenterChoices(instances: TestcenterInstanceDto[]): Testcenter[] {
  let nextId = 7;
  return instances.map(instance => {
    const numbered = /^https:\/\/iqb-testcenter([1-5])\.de$/.exec(instance.baseUrl);
    if (numbered) return { id: Number(numbered[1]), label: instance.label };
    const choice = { id: nextId, label: instance.label, url: instance.baseUrl };
    nextId += 1;
    return choice;
  });
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
