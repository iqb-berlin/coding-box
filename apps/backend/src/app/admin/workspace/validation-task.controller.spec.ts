import { ValidationTaskController } from './validation-task.controller';

describe('ValidationTaskController audit identity', () => {
  it.each(['body', 'query'])('replaces the %s user ID with the authenticated actor', async source => {
    const service = { createValidationTask: jest.fn().mockResolvedValue({ id: 1 }) };
    const controller = new ValidationTaskController(service as never);
    await controller.createValidationTask(3, 'deleteTestResults', undefined, undefined, source === 'query' ? { userId: '99', scope: 'persons', personIds: '42' } : undefined, source === 'body' ? { additionalData: { userId: '99', scope: 'persons', personIds: [42] } } : undefined, { user: { id: 7 } });
    expect(service.createValidationTask).toHaveBeenCalledWith(3, 'deleteTestResults', undefined, undefined, expect.objectContaining({ userId: '7', scope: 'persons' }));
  });

  it('does not fall back to a client-supplied actor when authentication context is absent', async () => {
    const service = { createValidationTask: jest.fn().mockResolvedValue({ id: 1 }) };
    await new ValidationTaskController(service as never).createValidationTask(3, 'deleteTestResults', undefined, undefined, { userId: '99' });
    expect(service.createValidationTask).toHaveBeenCalledWith(3, 'deleteTestResults', undefined, undefined, { userId: '' });
  });
});
