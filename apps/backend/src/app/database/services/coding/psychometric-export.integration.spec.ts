import * as fs from 'fs';
import { PassThrough } from 'stream';
import { CodingPsychometricExportService } from './coding-psychometric-export.service';
import { PsychometricAnalysisEngine } from './psychometric-analysis-engine';
import { PsychometricExportWriter } from './psychometric-export-writer.service';
import { PsychometricMetadataResolver } from './psychometric-metadata-resolver.service';
import { PsychometricResponseReader } from './psychometric-response-reader.service';

interface AnalysisResponseRow {
  responseId: number;
  personId: number;
  unitName: string;
  variableId: string;
  value: string;
  statusV1: number;
  codeV1: number;
  scoreV1: number;
  statusV2: number;
  codeV2: number;
  scoreV2: number;
  statusV3: number;
  codeV3: number;
  scoreV3: number;
}

describe('Psychometric export integration', () => {
  const createService = (
    vomd: Record<string, unknown>,
    variables: Array<Record<string, unknown>>
  ) => {
    const metadataResolver = new PsychometricMetadataResolver(
      {
        find: jest.fn().mockResolvedValue([
          {
            id: 1,
            file_id: 'UNIT_A.VOMD',
            filename: 'UNIT_A.vomd',
            data: JSON.stringify(vomd)
          }
        ])
      } as never,
      {
        getUnitVariableDetails: jest.fn().mockResolvedValue([
          {
            unitName: 'UNIT_A',
            unitId: 'UNIT_A',
            variables
          }
        ])
      } as never,
      {} as never
    );
    return new CodingPsychometricExportService(
      metadataResolver,
      {} as never,
      new PsychometricAnalysisEngine(),
      new PsychometricExportWriter()
    );
  };

  const collectStream = async (
    stream: NodeJS.ReadableStream
  ): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  };

  const createAnalysisService = (
    responseOverrides: Record<number, Partial<AnalysisResponseRow>> = {}
  ): CodingPsychometricExportService => {
    const responseRows: AnalysisResponseRow[] = [
      {
        responseId: 1,
        personId: 1,
        unitName: 'UNIT_A',
        variableId: 'V1',
        value: 'A',
        codeV1: 1,
        scoreV1: 1,
        codeV2: 1,
        scoreV2: 1,
        codeV3: 1,
        scoreV3: 1
      },
      {
        responseId: 2,
        personId: 2,
        unitName: 'UNIT_A',
        variableId: 'V1',
        value: 'B',
        codeV1: 0,
        scoreV1: 0,
        codeV2: 0,
        scoreV2: 0,
        codeV3: 0,
        scoreV3: 0
      },
      {
        responseId: 3,
        personId: 3,
        unitName: 'UNIT_A',
        variableId: 'V1',
        value: 'A',
        codeV1: 1,
        scoreV1: 1,
        codeV2: 1,
        scoreV2: 1,
        codeV3: 1,
        scoreV3: 1
      },
      {
        responseId: 4,
        personId: 4,
        unitName: 'UNIT_A',
        variableId: 'V1',
        value: '[false,false,false,false]',
        codeV1: 0,
        scoreV1: 0,
        codeV2: 0,
        scoreV2: 0,
        codeV3: 0,
        scoreV3: 0
      },
      {
        responseId: 5,
        personId: 1,
        unitName: 'UNIT_A',
        variableId: 'HELPER',
        value: 'x',
        codeV1: 1,
        scoreV1: 1,
        codeV2: 1,
        scoreV2: 1,
        codeV3: 1,
        scoreV3: 1
      },
      {
        responseId: 6,
        personId: 1,
        unitName: 'UNIT_A',
        variableId: 'HELPER',
        value: 'y',
        codeV1: 1,
        scoreV1: 1,
        codeV2: 1,
        scoreV2: 1,
        codeV3: 1,
        scoreV3: 1
      }
    ].map(row => ({
      statusV1: 5,
      statusV2: 5,
      statusV3: 5,
      ...row,
      ...responseOverrides[row.responseId]
    }));
    const responseRepository = {
      createQueryBuilder: jest.fn(() => {
        let grouped = false;
        let lastResponseId = 0;
        let statusKey: 'statusV1' | 'statusV2' | 'statusV3' | null = null;
        let ignoredStatuses: number[] = [];
        let variablePairKeys: string[] | null = null;
        const getScopedRows = () => responseRows.filter(row => {
          if (statusKey === null) {
            return true;
          }
          const status = row[statusKey];
          const variablePairKey = [
            row.unitName
              .trim()
              .replace(/^.*[\\/]/, '')
              .replace(/\.(VOMD|VOCS|XML)$/i, '')
              .trim()
              .toUpperCase(),
            row.variableId.trim().toUpperCase()
          ].join('\u001F');
          return (
            status !== null &&
              !ignoredStatuses.includes(status) &&
              (variablePairKeys === null ||
                variablePairKeys.includes(variablePairKey))
          );
        });
        const queryBuilder = {
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn(
            (
              condition: string,
              parameters?: {
                lastResponseId?: number;
                psychometricIgnoredStatuses?: number[];
                psychometricVariablePairKeys?: string[];
              }
            ) => {
              if (condition.includes('response.id >')) {
                lastResponseId = parameters?.lastResponseId || 0;
              }
              const statusMatch = condition.match(/response\.status_(v[123])/);
              if (statusMatch) {
                statusKey = `status${statusMatch[1].toUpperCase()}` as
                  'statusV1' | 'statusV2' | 'statusV3';
              }
              if (parameters?.psychometricIgnoredStatuses) {
                ignoredStatuses = parameters.psychometricIgnoredStatuses;
              }
              if (parameters?.psychometricVariablePairKeys) {
                variablePairKeys = parameters.psychometricVariablePairKeys;
              }
              return queryBuilder;
            }
          ),
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          groupBy: jest.fn(() => {
            grouped = true;
            return queryBuilder;
          }),
          addGroupBy: jest.fn().mockReturnThis(),
          having: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          getCount: jest.fn(async () => getScopedRows().length),
          getRawMany: jest.fn(async () => {
            if (grouped) {
              const counts = new Map<string, number>();
              getScopedRows().forEach(row => {
                const key = [
                  row.personId,
                  row.unitName.toUpperCase(),
                  row.variableId.toUpperCase()
                ].join('\u001F');
                counts.set(key, (counts.get(key) || 0) + 1);
              });
              return Array.from(counts.entries())
                .filter(([, count]) => count > 1)
                .map(([key]) => {
                  const [personId, unitName, variableId] = key.split('\u001F');
                  return {
                    personId: Number(personId),
                    unitName,
                    variableId
                  };
                });
            }
            const version = statusKey?.slice(-2) || 'V2';
            const codeKey = `code${version}` as 'codeV1' | 'codeV2' | 'codeV3';
            const scoreKey = `score${version}` as
              'scoreV1' | 'scoreV2' | 'scoreV3';
            return getScopedRows()
              .filter(row => row.responseId > lastResponseId)
              .map(row => ({
                responseId: row.responseId,
                personId: row.personId,
                unitName: row.unitName,
                variableId: row.variableId,
                value: row.value,
                code: row[codeKey],
                score: row[scoreKey]
              }));
          })
        };
        return queryBuilder;
      })
    };
    const queryRunner = {
      manager: {
        getRepository: jest.fn().mockReturnValue(responseRepository)
      },
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: true,
      isReleased: false
    };
    const connection = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
      queryRunner
    };

    const metadataResolver = new PsychometricMetadataResolver(
      {
        find: jest.fn().mockResolvedValue([
          {
            id: 1,
            file_id: 'UNIT_A.VOMD',
            filename: 'UNIT_A.vomd',
            data: JSON.stringify({
              items: [
                {
                  id: 'ITEM_1',
                  variableId: 'V1',
                  description: '=Item label'
                }
              ]
            })
          }
        ])
      } as never,
      {
        getUnitVariableDetails: jest.fn().mockResolvedValue([
          {
            unitName: 'UNIT_A',
            unitId: 'UNIT_A',
            variables: [
              {
                id: 'V1',
                alias: 'V1',
                type: 'string',
                multiple: true,
                hasCodingScheme: true,
                codes: [
                  { id: 0, label: 'incorrect', score: 0 },
                  { id: 1, label: 'correct', score: 1 }
                ],
                values: [
                  { value: 'A', label: 'Option A' },
                  { value: 'B', label: 'Option B' },
                  { value: 'C', label: 'Unused option' },
                  { value: '=2+2', label: '=Formula label' }
                ]
              },
              {
                id: 'HELPER',
                alias: 'HELPER',
                type: 'string',
                hasCodingScheme: false
              }
            ]
          }
        ])
      } as never,
      {
        resolveMissingsProfileId: jest.fn().mockResolvedValue(1),
        getMissingsProfileDetails: jest.fn().mockResolvedValue({
          parseMissings: () => [
            {
              id: 'mir',
              code: -98,
              score: 0,
              label: 'MIR'
            },
            {
              id: 'mci',
              code: -97,
              score: null,
              label: 'MCI'
            }
          ]
        })
      } as never
    );
    const responseReader = new PsychometricResponseReader(
      {
        resolveExclusionsForQueries: jest.fn().mockResolvedValue({
          globalIgnoredUnits: [],
          ignoredBooklets: [],
          testletIgnoredUnits: []
        })
      } as never,
      connection as never
    );

    return new CodingPsychometricExportService(
      metadataResolver,
      responseReader,
      new PsychometricAnalysisEngine(),
      new PsychometricExportWriter()
    );
  };

  it('discovers complete, single-valued item domain fields from VOMD', async () => {
    const service = createService(
      {
        items: [
          {
            id: 'I1',
            variableId: 'V1',
            profiles: [
              {
                profileId: 'profile',
                entries: [
                  {
                    id: 'domain',
                    label: [{ lang: 'de', value: 'Kompetenzbereich' }],
                    value: [
                      {
                        id: 'D1',
                        label: [{ lang: 'de', value: 'Domäne 1' }],
                        annotation: []
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            id: 'I2',
            variableId: 'V2',
            profiles: [
              {
                profileId: 'profile',
                entries: [
                  {
                    id: 'domain',
                    label: [{ lang: 'de', value: 'Kompetenzbereich' }],
                    value: [
                      {
                        id: 'D2',
                        label: [{ lang: 'de', value: 'Domäne 2' }],
                        annotation: []
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      [
        {
          id: 'V1',
          alias: 'V1',
          type: 'string',
          hasCodingScheme: true
        },
        {
          id: 'V2',
          alias: 'V2',
          type: 'string',
          hasCodingScheme: true
        }
      ]
    );

    await expect(service.getDomainCandidates(7)).resolves.toEqual({
      candidates: [
        expect.objectContaining({
          scope: 'ITEM',
          profileId: 'profile',
          entryId: 'domain',
          label: 'Kompetenzbereich',
          coverage: 2,
          itemCount: 2,
          singleValued: true,
          selectable: true
        })
      ],
      mappingIssueCount: 0
    });
  });

  it('marks incomplete or multi-valued VOMD fields as unavailable', async () => {
    const service = createService(
      {
        items: [
          {
            id: 'I1',
            variableId: 'V1',
            profiles: [
              {
                profileId: 'profile',
                entries: [
                  {
                    id: 'domain',
                    value: [{ id: 'D1' }, { id: 'D2' }]
                  }
                ]
              }
            ]
          },
          {
            id: 'I2',
            variableId: 'V2',
            profiles: []
          }
        ]
      },
      [
        {
          id: 'V1',
          alias: 'V1',
          type: 'string',
          hasCodingScheme: true
        },
        {
          id: 'V2',
          alias: 'V2',
          type: 'string',
          hasCodingScheme: true
        }
      ]
    );

    const { candidates, mappingIssueCount } =
      await service.getDomainCandidates(7);
    const candidate = candidates[0];
    expect(candidate).toEqual(
      expect.objectContaining({
        coverage: 1,
        itemCount: 2,
        singleValued: false,
        selectable: false
      })
    );
    expect(mappingIssueCount).toBe(0);
  });

  it('reports mapping issues when no domain candidates can be mapped', async () => {
    const service = createService(
      {
        items: [
          {
            id: 'I1',
            variableId: 'UNKNOWN'
          }
        ]
      },
      [
        {
          id: 'V1',
          alias: 'V1',
          type: 'string',
          hasCodingScheme: true
        }
      ]
    );

    await expect(service.getDomainCandidates(7)).resolves.toEqual({
      candidates: [],
      mappingIssueCount: 1
    });
  });

  it('ignores obsolete VOMD profile values', async () => {
    const service = createService(
      {
        items: [
          {
            id: 'I1',
            variableId: 'V1',
            profiles: [
              {
                profileId: 'profile',
                isCurrent: false,
                entries: [{ id: 'old-domain', value: [{ id: 'OLD' }] }]
              },
              {
                profileId: 'profile',
                isCurrent: true,
                entries: [{ id: 'domain', value: [{ id: 'D1' }] }]
              }
            ]
          }
        ]
      },
      [
        {
          id: 'V1',
          alias: 'V1',
          type: 'string',
          hasCodingScheme: true
        }
      ]
    );

    const { candidates } = await service.getDomainCandidates(7);
    expect(candidates).toEqual([
      expect.objectContaining({ entryId: 'domain', selectable: true })
    ]);
  });

  it('maps VOMD items instead of requiring metadata for every unit variable', async () => {
    const service = createAnalysisService();

    const csv = await collectStream(
      await service.exportPsychometricsAsCsv({
        workspaceId: 7,
        version: 'v2',
        partWholeCorrection: false,
        domain: { mode: 'workspace' }
      })
    );

    expect(csv).toContain('SCORE;WORKSPACE');
    expect(csv).toContain('CATEGORY;WORKSPACE');
    expect(csv).not.toContain(';HELPER;');
  });

  it('matches response unit names with paths and resource suffixes', async () => {
    const service = createAnalysisService({
      1: { unitName: 'folder/UNIT_A.XML' }
    });
    const analysis = await (
      service as never as {
        analyze: (options: {
          workspaceId: number;
          version: 'v2';
          partWholeCorrection: boolean;
        }) => Promise<{
          rows: Array<{
            type: string;
            n: number;
          }>;
        }>;
      }
    ).analyze({
      workspaceId: 7,
      version: 'v2',
      partWholeCorrection: false
    });

    expect(analysis.rows.find(row => row.type === 'SCORE')).toEqual(
      expect.objectContaining({ n: 4 })
    );
  });

  it('excludes codes and scores with ignored statuses for the selected version', async () => {
    const overrides = {
      1: {
        statusV2: 0,
        codeV2: 99,
        scoreV2: 99
      }
    };
    const v2Service = createAnalysisService(overrides);
    const v2Analysis = await (
      v2Service as never as {
        analyze: (options: {
          workspaceId: number;
          version: 'v2';
          partWholeCorrection: boolean;
        }) => Promise<{
          rows: Array<{
            type: string;
            code: string;
            n: number;
          }>;
        }>;
      }
    ).analyze({
      workspaceId: 7,
      version: 'v2',
      partWholeCorrection: false
    });

    expect(v2Analysis.rows.find(row => row.type === 'SCORE')).toEqual(
      expect.objectContaining({ n: 3 })
    );
    expect(
      v2Analysis.rows.some(row => row.type === 'CODE' && row.code === '99')
    ).toBe(false);

    const v1Service = createAnalysisService(overrides);
    const v1Analysis = await (
      v1Service as never as {
        analyze: (options: {
          workspaceId: number;
          version: 'v1';
          partWholeCorrection: boolean;
        }) => Promise<{
          rows: Array<{
            type: string;
            n: number;
          }>;
        }>;
      }
    ).analyze({
      workspaceId: 7,
      version: 'v1',
      partWholeCorrection: false
    });

    expect(v1Analysis.rows.find(row => row.type === 'SCORE')).toEqual(
      expect.objectContaining({ n: 4 })
    );
  });

  it('uses one read-only repeatable-read snapshot for both response passes', async () => {
    const service = createAnalysisService();
    const dependencies = service as never as {
      responseReader: {
        connection: {
          queryRunner: {
            startTransaction: jest.Mock;
            query: jest.Mock;
            commitTransaction: jest.Mock;
            rollbackTransaction: jest.Mock;
            release: jest.Mock;
          };
        };
        workspaceExclusionService: {
          resolveExclusionsForQueries: jest.Mock;
        };
      };
    };

    await collectStream(
      await service.exportPsychometricsAsCsv({
        workspaceId: 7,
        partWholeCorrection: false
      })
    );

    expect(
      dependencies.responseReader.workspaceExclusionService
        .resolveExclusionsForQueries
    ).toHaveBeenCalledTimes(1);
    expect(
      dependencies.responseReader.connection.queryRunner.startTransaction
    ).toHaveBeenCalledWith('REPEATABLE READ');
    expect(
      dependencies.responseReader.connection.queryRunner.query
    ).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
    expect(
      dependencies.responseReader.connection.queryRunner.commitTransaction
    ).toHaveBeenCalledTimes(1);
    expect(
      dependencies.responseReader.connection.queryRunner.rollbackTransaction
    ).not.toHaveBeenCalled();
    expect(
      dependencies.responseReader.connection.queryRunner.release
    ).toHaveBeenCalledTimes(1);
  });

  it('returns the CSV stream before analysis completes', async () => {
    const service = createAnalysisService();
    let resolveAnalysis:
    ((analysis: { rows: []; summary: [] }) => void) | undefined;
    const analysisPromise = new Promise<{
      rows: [];
      summary: [];
    }>(resolve => {
      resolveAnalysis = resolve;
    });
    jest
      .spyOn(service as never as { analyze: () => Promise<unknown> }, 'analyze')
      .mockReturnValue(analysisPromise);

    let returnedStream: NodeJS.ReadableStream | undefined;
    service
      .exportPsychometricsAsCsv({
        workspaceId: 7,
        partWholeCorrection: false
      })
      .then(stream => {
        returnedStream = stream;
      });

    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
    expect(returnedStream).toBeDefined();

    const csvPromise = collectStream(returnedStream!);
    resolveAnalysis?.({ rows: [], summary: [] });

    await expect(csvPromise).resolves.toContain('type;domain;domain_label');
  });

  it('stops CSV production when the output stream is destroyed', async () => {
    const service = createAnalysisService();
    let resolveAnalysis:
    ((analysis: { rows: unknown[]; summary: [] }) => void) | undefined;
    const analysisPromise = new Promise<{
      rows: unknown[];
      summary: [];
    }>(resolve => {
      resolveAnalysis = resolve;
    });
    jest
      .spyOn(service as never as { analyze: () => Promise<unknown> }, 'analyze')
      .mockReturnValue(analysisPromise);
    const exportWriter = (
      service as never as {
        exportWriter: PsychometricExportWriter;
      }
    ).exportWriter;
    const writer = jest.spyOn(
      exportWriter as never as {
        writeCsv: (
          output: NodeJS.WritableStream,
          analyze: unknown,
          checkCancellation?: () => Promise<void>
        ) => Promise<void>;
      },
      'writeCsv'
    );

    const stream = await service.exportPsychometricsAsCsv({
      workspaceId: 7,
      partWholeCorrection: false
    });
    stream.on('error', () => undefined);
    const closed = new Promise<void>(resolve => {
      stream.once('close', resolve);
    });
    (
      stream as NodeJS.ReadableStream & {
        destroy: (error?: Error) => void;
      }
    ).destroy(new Error('destination failed'));
    await closed;

    const row = {
      type: 'SCORE',
      domain: 'WORKSPACE',
      domainLabel: 'Gesamter Workspace',
      unit: 'UNIT_A',
      item: 'I1',
      variable: 'V1',
      itemLabel: 'x'.repeat(500),
      code: '',
      category: '',
      label: '',
      score: '',
      source: '',
      n: 1,
      positiveN: '',
      positiveShare: '',
      correlation: '',
      status: 'TOO_FEW_CASES',
      note: ''
    };
    resolveAnalysis?.({
      rows: Array.from({ length: 2000 }, () => row),
      summary: []
    });

    const production = writer.mock.results[0].value;
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
    if (timeout) {
      clearTimeout(timeout);
    }
  });

  it('propagates output destruction into the running CSV analysis', async () => {
    const service = createAnalysisService();
    let continueAnalysis: (() => void) | undefined;
    let analysisStarted: (() => void) | undefined;
    const analysisStartedPromise = new Promise<void>(resolve => {
      analysisStarted = resolve;
    });
    const continueAnalysisPromise = new Promise<void>(resolve => {
      continueAnalysis = resolve;
    });
    jest
      .spyOn(
        service as never as {
          analyze: (options: {
            checkCancellation?: () => Promise<void>;
          }) => Promise<unknown>;
        },
        'analyze'
      )
      .mockImplementation(async options => {
        analysisStarted?.();
        await continueAnalysisPromise;
        await options.checkCancellation?.();
        return { rows: [], summary: [] };
      });
    const exportWriter = (
      service as never as {
        exportWriter: PsychometricExportWriter;
      }
    ).exportWriter;
    const writer = jest.spyOn(
      exportWriter as never as {
        writeCsv: (
          output: NodeJS.WritableStream,
          analyze: unknown,
          checkCancellation?: () => Promise<void>
        ) => Promise<void>;
      },
      'writeCsv'
    );

    const stream = await service.exportPsychometricsAsCsv({
      workspaceId: 7,
      partWholeCorrection: false
    });
    await analysisStartedPromise;
    stream.on('error', () => undefined);
    const closed = new Promise<void>(resolve => {
      stream.once('close', resolve);
    });
    (
      stream as NodeJS.ReadableStream & {
        destroy: (error?: Error) => void;
      }
    ).destroy(new Error('destination failed'));
    await closed;

    continueAnalysis?.();

    await expect(writer.mock.results[0].value).resolves.toBeUndefined();
  });

  it('destroys the Excel output stream when finalization is cancelled', async () => {
    const service = createAnalysisService();
    jest
      .spyOn(service as never as { analyze: () => Promise<unknown> }, 'analyze')
      .mockResolvedValue({ rows: [], summary: [] });
    const outputStream = new PassThrough();
    const createWriteStream = jest
      .spyOn(fs, 'createWriteStream')
      .mockReturnValue(outputStream as never);
    const cancellationError = new Error('cancelled');
    let cancellationChecks = 0;

    try {
      await expect(
        service.writePsychometricsExcelToFile('/tmp/psychometrics.xlsx', {
          workspaceId: 7,
          checkCancellation: async () => {
            cancellationChecks += 1;
            if (cancellationChecks >= 2) {
              throw cancellationError;
            }
          }
        })
      ).rejects.toThrow(cancellationError);

      expect(outputStream.destroyed).toBe(true);
    } finally {
      createWriteStream.mockRestore();
    }
  });

  it('exports zero dummies for unused categories and empty multiple responses', async () => {
    const service = createAnalysisService();
    const analysis = await (
      service as never as {
        analyze: (options: {
          workspaceId: number;
          partWholeCorrection: boolean;
        }) => Promise<{
          rows: Array<{
            type: string;
            category: string;
            n: number;
            positiveN: number | '';
            status: string;
          }>;
        }>;
      }
    ).analyze({ workspaceId: 7, partWholeCorrection: false });

    expect(analysis.rows).toContainEqual(
      expect.objectContaining({
        type: 'CATEGORY',
        category: 'C',
        n: 4,
        positiveN: 0,
        status: 'CONSTANT_ITEM'
      })
    );
  });

  it('sanitizes formula-like text in psychometric CSV exports', async () => {
    const service = createAnalysisService();

    const csv = await collectStream(
      await service.exportPsychometricsAsCsv({
        workspaceId: 7,
        partWholeCorrection: false
      })
    );

    expect(csv).toContain("'=Item label");
    expect(csv).toContain("'=2+2");
    expect(csv).toContain("'=Formula label");
    expect(csv).not.toMatch(/(^|;)=2\+2(;|$)/m);
  });
});
