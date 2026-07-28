import * as fs from 'fs';
import * as path from 'path';
import { PsychometricAnalysisEngine } from './psychometric-analysis-engine';
import { PsychometricExportWriter } from './psychometric-export-writer.service';
import {
  PsychometricItemMapping,
  PsychometricRawResponseRow,
  PsychometricResponseSnapshot
} from './psychometric-export.types';
import { getPsychometricLogicalKey } from './psychometric-key.util';

describe('Psychometric CSV golden master', () => {
  const collectStream = async (
    stream: NodeJS.ReadableStream
  ): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  };

  it('converts fixed response and item data into the approved CSV', async () => {
    const itemKey = getPsychometricLogicalKey('UNIT_A', 'V1');
    const mapping: PsychometricItemMapping = {
      items: [
        {
          key: itemKey,
          unitName: 'UNIT_A',
          variableId: 'V1',
          sourceVariableId: 'V1',
          itemId: 'ITEM_1',
          itemLabel: '=Item label',
          variable: {
            id: 'V1',
            alias: 'V1',
            type: 'string',
            multiple: false,
            hasCodingScheme: true,
            codes: [
              { id: 0, label: 'incorrect', score: 0 },
              { id: 1, label: 'correct', score: 1 }
            ],
            values: [
              { value: 'A', label: 'Option A' },
              { value: 'B', label: '=Formula label' }
            ]
          },
          vomd: {
            fileName: 'UNIT_A.vomd',
            unitKey: 'UNIT_A',
            profiles: [],
            items: []
          },
          vomdItem: {
            id: 'ITEM_1',
            variableId: 'V1',
            profiles: []
          },
          domain: {
            id: 'WORKSPACE',
            label: 'Gesamter Workspace'
          }
        }
      ],
      byLogicalKey: new Map(),
      issues: [],
      fallbacks: []
    };
    mapping.byLogicalKey.set(itemKey, mapping.items[0]);

    const rows: PsychometricRawResponseRow[] = [
      {
        responseId: 1,
        personId: 1,
        unitName: 'folder/UNIT_A.XML',
        variableId: ' v1 ',
        value: 'A',
        code: 1,
        score: 1
      },
      {
        responseId: 2,
        personId: 2,
        unitName: 'UNIT_A',
        variableId: 'V1',
        value: 'B',
        code: 0,
        score: 0
      }
    ];
    const snapshot: PsychometricResponseSnapshot = {
      duplicatePersonIds: new Set(),
      totalRows: rows.length,
      forEachBatch: async callback => callback(rows, rows.length)
    };
    const analysis = await new PsychometricAnalysisEngine().analyze({
      options: {
        workspaceId: 7,
        version: 'v2',
        partWholeCorrection: false,
        domain: { mode: 'workspace' },
        maxCategoryCount: 10
      },
      mapping,
      missingDefinitions: [],
      snapshot
    });
    const writer = new PsychometricExportWriter();
    const actual = await collectStream(
      writer.createCsvStream(async () => analysis)
    );
    const expected = fs.readFileSync(
      path.join(__dirname, 'test-data', 'psychometric-export.golden.csv'),
      'utf8'
    );

    expect(actual).toBe(expected.trimEnd());
  });
});
