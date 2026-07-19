import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { PassThrough } from 'stream';
import { PsychometricExportWriter } from './psychometric-export-writer.service';

describe('PsychometricExportWriter', () => {
  const collectStream = async (
    stream: NodeJS.ReadableStream
  ): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  };

  it('returns a CSV stream before analysis completes and sanitizes text', async () => {
    const writer = new PsychometricExportWriter();
    let resolveAnalysis:
    | ((value: { rows: Array<Record<string, unknown>>; summary: [] }) => void)
    | undefined;
    const analysis = new Promise<{
      rows: Array<Record<string, unknown>>;
      summary: [];
    }>(resolve => {
      resolveAnalysis = resolve;
    });

    const stream = writer.createCsvStream(async () => analysis as never);
    const csv = collectStream(stream);
    resolveAnalysis?.({
      rows: [
        {
          type: 'CATEGORY',
          domain: 'WORKSPACE',
          domainLabel: 'Gesamter Workspace',
          unit: 'UNIT_A',
          item: 'ITEM_1',
          variable: 'V1',
          itemLabel: '=Item label',
          code: '',
          category: '=2+2',
          label: '=Formula label',
          score: '',
          source: 'OBSERVED',
          n: 1,
          positiveN: 1,
          positiveShare: 1,
          correlation: '',
          status: 'CONSTANT_ITEM',
          note: ''
        }
      ],
      summary: []
    });

    await expect(csv).resolves.toContain("'=Item label");
    await expect(csv).resolves.toContain("'=2+2");
    await expect(csv).resolves.toContain("'=Formula label");
  });

  it('stops CSV production and cancels running analysis when the output stream is destroyed', async () => {
    const writer = new PsychometricExportWriter();
    const writeCsv = jest.spyOn(
      writer as never as {
        writeCsv: (
          output: NodeJS.WritableStream,
          analyze: unknown,
          checkCancellation?: () => Promise<void>
        ) => Promise<void>;
      },
      'writeCsv'
    );
    let signalAnalysisStarted: (() => void) | undefined;
    const analysisStarted = new Promise<void>(resolve => {
      signalAnalysisStarted = resolve;
    });
    let continueAnalysis: (() => void) | undefined;
    const analysisCanContinue = new Promise<void>(resolve => {
      continueAnalysis = resolve;
    });
    let observedCancellationError: unknown;
    const stream = writer.createCsvStream(async checkCancellation => {
      signalAnalysisStarted?.();
      await analysisCanContinue;
      try {
        await checkCancellation();
      } catch (error) {
        observedCancellationError = error;
        throw error;
      }
      return { rows: [], summary: [] };
    });
    await analysisStarted;
    stream.on('error', () => undefined);
    const closed = new Promise<void>(resolve => {
      stream.once('close', resolve);
    });

    const destinationError = new Error('destination failed');
    (
      stream as NodeJS.ReadableStream & {
        destroy: (error?: Error) => void;
      }
    ).destroy(destinationError);
    await closed;
    continueAnalysis?.();

    const production = writeCsv.mock.results[0].value;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const completion = Promise.race([
      production,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('CSV production did not stop')),
          500
        );
      })
    ]);

    await expect(completion).resolves.toBeUndefined();
    expect(observedCancellationError).toBe(destinationError);
    if (timeout) {
      clearTimeout(timeout);
    }
  });

  it('keeps the CSV header unchanged and does not mix in summary rows', async () => {
    const writer = new PsychometricExportWriter();
    const csv = await collectStream(
      writer.createCsvStream(async () => ({
        rows: [],
        summary: [{ key: 'Items insgesamt', value: 0 }]
      }))
    );

    expect(csv.split(/\r?\n/)[0]).toBe(
      [
        'type',
        'domain',
        'domain_label',
        'unit',
        'item',
        'variable',
        'item_label',
        'code',
        'category',
        'label',
        'score',
        'source',
        'n',
        'positive_n',
        'positive_share',
        'correlation',
        'status',
        'note'
      ].join(';')
    );
    expect(csv).not.toContain('Items insgesamt');
  });

  it('writes score-summary metrics to the Excel overview worksheet', async () => {
    const writer = new PsychometricExportWriter();
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'psychometric-export-')
    );
    const outputPath = path.join(temporaryDirectory, 'psychometrics.xlsx');

    try {
      await writer.writeExcelToFile(outputPath, {
        rows: [],
        summary: [
          { key: 'Items insgesamt', value: 5 },
          { key: 'Items mit n = 0', value: 1 },
          {
            key: 'Median paarweise vollständige Fälle (n)',
            value: 29
          }
        ]
      });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(outputPath);
      const overview = workbook.getWorksheet('Übersicht');
      const metrics = new Map(
        overview
          ?.getRows(2, Math.max(0, (overview?.rowCount || 1) - 1))
          ?.map(row => [
            String(row.getCell(1).value),
            row.getCell(2).value
          ]) || []
      );

      expect(metrics.get('Items insgesamt')).toBe(5);
      expect(metrics.get('Items mit n = 0')).toBe(1);
      expect(
        metrics.get('Median paarweise vollständige Fälle (n)')
      ).toBe(29);
      expect(
        workbook
          .getWorksheet('Score-Trennschärfen')
          ?.getRow(1)
          .getCell(12).value
      ).toBe('n (paarweise vollständige Fälle)');
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('destroys the Excel output when finalization is cancelled', async () => {
    const writer = new PsychometricExportWriter();
    const output = new PassThrough();
    const createWriteStream = jest
      .spyOn(fs, 'createWriteStream')
      .mockReturnValue(output as never);
    let cancellationChecks = 0;

    try {
      await expect(
        writer.writeExcelToFile(
          '/tmp/psychometrics.xlsx',
          { rows: [], summary: [] },
          async () => {
            cancellationChecks += 1;
            if (cancellationChecks >= 2) {
              throw new Error('cancelled');
            }
          }
        )
      ).rejects.toThrow('cancelled');

      expect(output.destroyed).toBe(true);
    } finally {
      createWriteStream.mockRestore();
    }
  });
});
