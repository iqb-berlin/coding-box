import { PassThrough } from 'node:stream';
import { UploadProgress } from './upload-progress';

describe('UploadProgress', () => {
  it('reports DB processing before all bytes have been read and returns to reading afterwards', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const progress = new UploadProgress(send);
    const input = new PassThrough();
    progress.track(input, 10);
    await progress.setPhase('reading');

    input.write(Buffer.alloc(5));
    await progress.setPhase('processing');
    input.write(Buffer.alloc(5));

    expect(send.mock.calls.map(([value]) => value)).toEqual([
      { phase: 'reading', progress: 0 },
      { phase: 'reading', progress: 50 },
      { phase: 'processing', progress: 50 }
    ]);

    await progress.setPhase('reading');
    expect(send).toHaveBeenLastCalledWith({ phase: 'reading', progress: 100 });
    input.end();
  });
});
