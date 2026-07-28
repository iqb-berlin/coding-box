import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Writable } from 'stream';
import { writeIncompleteItemMatrixPackage } from './item-matrix-export-diagnostics.util';

describe('item matrix export diagnostics utilities', () => {
  it('closes the ZIP pipeline when the destination stream fails', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-package-'));
    const matrixPath = path.join(tempDir, 'matrix.csv');
    fs.writeFileSync(matrixPath, 'header\r\nvalue\r\n');
    const streamError = new Error('disk full');
    const output = new Writable({
      write: (_chunk, _encoding, callback) => callback(streamError)
    });
    const createWriteStream = jest
      .spyOn(fs, 'createWriteStream')
      .mockReturnValue(output as never);

    try {
      await expect(writeIncompleteItemMatrixPackage(
        path.join(tempDir, 'incomplete.zip'),
        matrixPath,
        'Itemdatensatz-UNVOLLSTAENDIG.csv',
        {
          diagnostics: {
            total: 1,
            sampleLimit: 20,
            groups: [{
              reasonCode: 'unresolved-status',
              bookletName: 'BOOKLET-1',
              columnName: 'UNIT1_ITEM1',
              count: 1,
              sampleRowNumbers: [2]
            }]
          },
          version: 'v2',
          matrixValue: 'score',
          missingsProfileId: 4,
          createdAt: Date.now()
        }
      )).rejects.toThrow('disk full');
      expect(output.destroyed).toBe(true);
    } finally {
      createWriteStream.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
