import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseString } from 'fast-csv';
import { ItemMatrixDiagnosticsArchive } from './item-matrix-diagnostics-archive';
import { ItemMatrixDiagnosticsWriter } from './item-matrix-diagnostics-writer';
import { ExportArtifactService } from './export-artifact.service';
import type { ItemMatrixExportDiagnosticCellDto } from '../../../../../../../api-dto/coding/export-request.dto';

describe('persistent item matrix diagnoses', () => {
  let directory: string;
  let archive: ItemMatrixDiagnosticsArchive;
  const entry = {
    jobId: '214',
    createdAt: 1000,
    total: 5480,
    version: 'v2' as const,
    matrixValue: 'score' as const,
    missingsProfileId: 4
  };
  const diagnostics = { total: 5480, sampleLimit: 20, groups: [] };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-diagnosis-'));
    archive = new ItemMatrixDiagnosticsArchive();
    jest.spyOn(archive, 'getRootDirectory').mockReturnValue(path.join(directory, 'archive'));
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  const cell = (rowNumber: number): ItemMatrixExportDiagnosticCellDto => ({
    rowNumber,
    columnNumber: 5,
    personLogin: '=unsafe',
    personCode: 'code;"1"',
    personGroup: 'group',
    bookletId: 42,
    bookletName: 'BOOKLET',
    columnName: 'UNIT_VAR',
    unitId: 'UNIT',
    variableId: 'VAR',
    reasonCode: rowNumber % 2 ? 'derived-result-missing' : 'derived-source-unresolved'
  });

  it('writes every cell deterministically, with identifiers, positions and CSV escaping', async () => {
    const write = async (name: string) => {
      const file = path.join(directory, name);
      const writer = await ItemMatrixDiagnosticsWriter.create(file);
      for (let row = 2; row < 5482; row += 1) await writer.write(cell(row));
      await writer.close();
      return fs.readFileSync(file, 'utf8');
    };
    const csv = await write('first.csv');
    expect(await write('second.csv')).toBe(csv);
    const rows = await new Promise<Record<string, string>[]>((resolve, reject) => {
      const result: Record<string, string>[] = [];
      parseString(csv, { headers: true, delimiter: ';' })
        .on('data', row => result.push(row)).on('error', reject).on('end', () => resolve(result));
    });
    expect(rows).toHaveLength(5480);
    expect(rows[0]).toMatchObject({
      zeile: '2',
      spaltennummer: '5',
      person_login: "'=unsafe",
      person_code: 'code;"1"',
      booklet_id: '42',
      unit: 'UNIT',
      variable: 'VAR',
      reason_code: 'derived-source-unresolved'
    });
    expect(rows[5479]).toMatchObject({ zeile: '5481', reason_code: 'derived-result-missing' });
  });

  it('survives cache expiry, job removal, file cleanup and a fresh service instance', async () => {
    const csv = path.join(directory, 'cells.csv');
    fs.writeFileSync(csv, 'full diagnosis');
    const id = await archive.publish(7, entry, diagnostics, csv);
    fs.unlinkSync(csv);
    new ExportArtifactService({} as never, {} as never).cleanupExpiredArtifacts(directory);
    const restarted = new ItemMatrixDiagnosticsArchive();
    jest.spyOn(restarted, 'getRootDirectory').mockReturnValue(archive.getRootDirectory());
    expect(await restarted.list(7)).toEqual([{ ...entry, archiveId: id }]);
    expect((await restarted.get(7, id))?.diagnostics).toEqual({ ...diagnostics, archiveId: id });
    expect(fs.readFileSync((await restarted.getCsvPath(7, id))!, 'utf8')).toBe('full diagnosis');
    expect(await restarted.get(8, id)).toBeNull();
    expect(await restarted.getCsvPath(7, '../cells.csv')).toBeNull();
    expect(await restarted.list(8)).toEqual([]);
  });

  it('does not overwrite an earlier diagnosis when Redis reuses a job id', async () => {
    const csv = path.join(directory, 'cells.csv');
    fs.writeFileSync(csv, 'first');
    const first = await archive.publish(7, entry, diagnostics, csv);
    fs.writeFileSync(csv, 'second');
    const second = await archive.publish(7, entry, diagnostics, csv);
    expect(first).not.toBe(second);
    expect(await archive.list(7)).toHaveLength(2);
    expect(fs.readFileSync((await archive.getCsvPath(7, first))!, 'utf8')).toBe('first');
  });

  it('never exposes a partial archive when copying fails', async () => {
    await expect(archive.publish(7, entry, diagnostics, path.join(directory, 'missing'))).rejects.toThrow();
    expect(await archive.list(7)).toEqual([]);
    expect(fs.readdirSync(path.join(archive.getRootDirectory(), '7'))).toEqual([]);
  });

  it('lists and downloads archives without reading the grouped diagnoses', async () => {
    const csv = path.join(directory, 'source.csv');
    fs.writeFileSync(csv, 'full cells');
    const id = await archive.publish(7, entry, diagnostics, csv);
    const read = jest.spyOn(fs.promises, 'readFile');
    try {
      expect(await archive.list(7)).toHaveLength(1);
      expect(await archive.getCsvPath(7, id)).not.toBeNull();
      expect(read.mock.calls.some(([file]) => String(file).endsWith('diagnostics.json'))).toBe(false);
    } finally {
      read.mockRestore();
    }
  });
});
