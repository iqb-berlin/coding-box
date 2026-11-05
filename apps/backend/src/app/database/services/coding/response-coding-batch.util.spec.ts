import { updateResponseCodingBatch } from './response-coding-batch.util';

describe('Response coding batches', () => {
  it('bounds database round trips and preserves null scores and negative codes', async () => {
    const manager = { query: jest.fn().mockResolvedValue([]) };
    const updates = Array.from({ length: 501 }, (_, index) => ({ responseId: index + 1, code: -98, score: null }));
    await updateResponseCodingBatch(manager as never, updates, 5);
    expect(manager.query).toHaveBeenCalledTimes(2);
    expect(manager.query.mock.calls[0][1]).toHaveLength(1501);
    expect(manager.query.mock.calls[1][1]).toEqual([5, 501, -98, null]);
    expect(manager.query.mock.calls[0][0]).toContain('autocoder_invalidated_version = NULL');
  });

  it('propagates a database error to the owning transaction without continuing', async () => {
    const manager = { query: jest.fn().mockRejectedValue(new Error('database unavailable')) };
    await expect(updateResponseCodingBatch(manager as never, [{ responseId: 1, code: 0, score: 0 }], 5))
      .rejects.toThrow('database unavailable');
    expect(manager.query).toHaveBeenCalledTimes(1);
  });
});
