import { UploadResultsProcessor } from './upload-results.processor';

describe('UploadResultsProcessor result persistence', () => {
  const job = { id: '123', data: { workspaceId: 1 } };

  it('returns a small reference after persisting the complete import result', async () => {
    const result = { issues: [{ message: 'full details' }] };
    const store = { save: jest.fn().mockResolvedValue({ kind: 'stored-job-result-v1', id: 'result' }) };
    const processor = new UploadResultsProcessor({ processUpload: jest.fn().mockResolvedValue(result) } as never, store as never);
    await expect(processor.handleUpload(job as never)).resolves.toEqual({ kind: 'stored-job-result-v1', id: 'result' });
    expect(store.save).toHaveBeenCalledWith(result, '123');
  });

  it('does not turn a committed import into a failed/retryable job when artifact storage fails', async () => {
    const result = { importedResponses: true };
    const processor = new UploadResultsProcessor(
      { processUpload: jest.fn().mockResolvedValue(result) } as never,
      { save: jest.fn().mockRejectedValue(new Error('disk full')) } as never
    );
    await expect(processor.handleUpload(job as never)).resolves.toBe(result);
  });
});
