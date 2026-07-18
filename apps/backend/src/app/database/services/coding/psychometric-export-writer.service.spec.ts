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
    ((value: {
      rows: Array<Record<string, unknown>>;
      summary: [];
    }) => void) | undefined;
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
});
