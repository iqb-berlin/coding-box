import { UploadSessionStore, RECORD_UPLOAD_CHUNK } from './upload-session.store';

describe('UploadSessionStore', () => {
  it('distinguishes an expired session from unavailable storage', async () => {
    const redis = { get: jest.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('offline')) };
    const store = new UploadSessionStore(redis as never);
    await expect(store.get('upload')).resolves.toBeNull();
    await expect(store.get('upload')).rejects.toMatchObject({ status: 503 });
  });

  it('fails writes instead of acknowledging an unsaved upload', async () => {
    const store = new UploadSessionStore({ set: jest.fn().mockRejectedValue(new Error('offline')) } as never);
    await expect(store.set('upload', {}, 3600)).rejects.toMatchObject({ status: 503 });
  });

  it('records a chunk in a single atomic operation and distinguishes expiration', async () => {
    const redis = { eval: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(-1).mockRejectedValueOnce(new Error('offline')) };
    const store = new UploadSessionStore(redis as never);
    await expect(store.recordChunk('upload', 1, 3600)).resolves.toBe(2);
    expect(redis.eval).toHaveBeenCalledWith(RECORD_UPLOAD_CHUNK, 1, 'upload', 1, 3600);
    await expect(store.recordChunk('upload', 1, 3600)).rejects.toMatchObject({ status: 404 });
    await expect(store.recordChunk('upload', 1, 3600)).rejects.toMatchObject({ status: 503 });
  });
});
