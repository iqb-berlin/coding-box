import { WorkspaceTestResultsImportController } from './workspace-test-results-import.controller';

describe('upload result access', () => {
  it('checks workspace ownership before loading a stored result', async () => {
    const job = {
      id: '1',
      data: { workspaceId: 2 },
      returnvalue: { kind: 'stored-job-result-v1', id: 'ref' },
      getState: jest.fn().mockResolvedValue('completed'),
      progress: jest.fn().mockResolvedValue(100)
    };
    const results = { read: jest.fn() };
    const controller = new WorkspaceTestResultsImportController(
      {} as never, {} as never, { getUploadJob: jest.fn().mockResolvedValue(job) } as never, {} as never, results as never
    );
    await expect(controller.getJobStatus(1, '1')).rejects.toMatchObject({ status: 404 });
    expect(results.read).not.toHaveBeenCalled();
  });

  it('returns the existing full-result API shape for stored artifacts', async () => {
    const reference = { kind: 'stored-job-result-v1', id: 'ref' };
    const result = { issues: [{ message: 'details' }] };
    const job = {
      id: '1',
      data: { workspaceId: 1 },
      returnvalue: reference,
      getState: jest.fn().mockResolvedValue('completed'),
      progress: jest.fn().mockResolvedValue(100)
    };
    const results = { read: jest.fn().mockResolvedValue(result) };
    const controller = new WorkspaceTestResultsImportController(
      {} as never, {} as never, { getUploadJob: jest.fn().mockResolvedValue(job) } as never, {} as never, results as never
    );
    await expect(controller.getJobStatus(1, '1')).resolves.toMatchObject({ status: 'completed', result });
    expect(results.read).toHaveBeenCalledWith(reference);
  });
});
