import type { Readable } from 'node:stream';
import type {
  TestResultsUploadPhase, TestResultsUploadProgressDto
} from '../../../../../../../api-dto/files/test-results-upload-progress.dto';

export class UploadProgress {
  private phase: TestResultsUploadPhase = 'processing';
  private percent = 0;

  constructor(private readonly send: (progress: TestResultsUploadProgressDto) => Promise<void>) {}

  async setPhase(phase: TestResultsUploadPhase): Promise<void> {
    if (phase === this.phase) return;
    this.phase = phase;
    await this.report();
  }

  track(file: Readable, size: number): void {
    if (!size) return;
    let bytes = 0;
    file.on('data', async (chunk: Buffer) => {
      bytes += chunk.length;
      const percent = Math.min(100, Math.floor((bytes / size) * 100));
      if (percent <= this.percent) return;
      this.percent = percent;
      // A read-ahead event can arrive while a batch is being saved.
      if (this.phase === 'reading') await this.report();
    });
  }

  private report(): Promise<void> {
    return this.send({ phase: this.phase, progress: this.percent });
  }
}
