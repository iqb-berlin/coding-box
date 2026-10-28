import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExternalCodingImportFile, removeExternalCodingImportFile } from './external-coding-import-file.util';

describe('external coding import file lifecycle', () => {
  it('cleans up a private directory even if its import file was already removed', () => {
    const file = createExternalCodingImportFile(Buffer.from('coding'));
    const directory = path.dirname(file);
    fs.unlinkSync(file);
    removeExternalCodingImportFile(file);
    expect(fs.existsSync(directory)).toBe(false);
  });

  it('retains the parent and sibling files of legacy queued jobs', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-import-test-'));
    const file = path.join(directory, 'legacy.csv');
    const sibling = path.join(directory, 'another-job.csv');
    try {
      fs.writeFileSync(file, 'coding');
      fs.writeFileSync(sibling, 'another job');
      removeExternalCodingImportFile(file);
      expect(fs.existsSync(file)).toBe(false);
      expect(fs.readFileSync(sibling, 'utf8')).toBe('another job');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('creates unique private directories for simultaneous imports', () => {
    const first = createExternalCodingImportFile(Buffer.from('first'));
    const second = createExternalCodingImportFile(Buffer.from('second'));
    try {
      expect(path.dirname(first)).not.toBe(path.dirname(second));
      expect(fs.readFileSync(first, 'utf8')).toBe('first');
      expect(fs.readFileSync(second, 'utf8')).toBe('second');
    } finally {
      removeExternalCodingImportFile(first);
      removeExternalCodingImportFile(second);
    }
  });
});
