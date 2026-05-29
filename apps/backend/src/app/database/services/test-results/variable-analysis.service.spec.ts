import { ConflictException, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { VariableAnalysisService } from './variable-analysis.service';

const createJob = (
  overrides: Partial<{
    id: string;
    data: {
      workspaceId: number;
      unitId?: number;
      variableId?: string;
      cacheKey?: string;
    };
    state: string;
    progress: number;
    returnvalue: unknown;
  }> = {}
) => ({
  id: overrides.id || 'job-1',
  data: overrides.data || {
    workspaceId: 1,
    unitId: 2,
    variableId: 'VAR',
    cacheKey: 'variable-analysis:1:job-1'
  },
  getState: jest.fn().mockResolvedValue(overrides.state || 'completed'),
  progress: jest.fn().mockResolvedValue(overrides.progress ?? 100),
  failedReason: undefined,
  timestamp: 1000,
  finishedOn: 2000,
  returnvalue: Object.prototype.hasOwnProperty.call(overrides, 'returnvalue') ?
    overrides.returnvalue :
    {
      cacheKey: 'variable-analysis:1:job-1',
      workspaceId: 1,
      total: 1,
      storedAt: '2026-05-26T00:00:00.000Z'
    }
});

describe('VariableAnalysisService', () => {
  let jobQueueService: Record<string, jest.Mock>;
  let cacheService: Record<string, jest.Mock>;
  let service: VariableAnalysisService;

  beforeEach(() => {
    jobQueueService = {
      addVariableAnalysisJob: jest.fn(),
      getVariableAnalysisJob: jest.fn(),
      getVariableAnalysisJobs: jest.fn(),
      deleteVariableAnalysisJob: jest.fn(),
      cancelVariableAnalysisJob: jest.fn(),
      deleteVariableAnalysisJobs: jest.fn()
    };
    cacheService = {
      get: jest.fn(),
      delete: jest.fn()
    };
    service = new VariableAnalysisService(
      jobQueueService as never,
      cacheService as never
    );
    jest
      .spyOn(
        (service as unknown as { logger: { log: jest.Mock } }).logger,
        'log'
      )
      .mockImplementation(jest.fn());
  });

  it('creates jobs unless one is already active', async () => {
    jest
      .spyOn(service, 'getAnalysisJobs')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'processing' } as never]);
    jobQueueService.addVariableAnalysisJob.mockResolvedValue({ id: 'job-1' });

    await expect(service.createAnalysisJob(1, 2, 'VAR')).resolves.toMatchObject(
      {
        id: 'job-1',
        workspace_id: 1,
        status: 'pending'
      }
    );
    expect(jobQueueService.addVariableAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: expect.stringMatching(
          /^variable-analysis:1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        )
      })
    );
    await expect(service.createAnalysisJob(1)).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it('loads jobs, results and validates workspace ownership', async () => {
    const cachedResult = {
      variableCombos: [],
      frequencies: {},
      total: 0
    };
    const job = createJob();
    cacheService.get
      .mockResolvedValueOnce(cachedResult)
      .mockResolvedValueOnce(null);
    jobQueueService.getVariableAnalysisJob
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createJob({ data: { workspaceId: 2 } }))
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce(createJob({ state: 'active' }))
      .mockResolvedValueOnce(createJob());

    await expect(service.getAnalysisJob('job-1', 1)).resolves.toMatchObject({
      id: 'job-1',
      workspace_id: 1,
      status: 'completed'
    });
    await expect(service.getAnalysisJob('missing', 1)).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(service.getAnalysisJob('wrong', 1)).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(service.getAnalysisResults('job-1', 1)).resolves.toEqual(
      cachedResult
    );
    expect(cacheService.get).toHaveBeenCalledWith('variable-analysis:1:job-1');
    await expect(service.getAnalysisResults('active', 1)).rejects.toThrow(
      'is not completed'
    );
    await expect(service.getAnalysisResults('empty', 1)).rejects.toThrow(
      'has no cached results'
    );
  });

  it('rejects full result loading for chunked cached results', async () => {
    jobQueueService.getVariableAnalysisJob.mockResolvedValue(
      createJob({
        returnvalue: {
          cacheKey: 'variable-analysis:1:job-1',
          workspaceId: 1,
          total: 1,
          storage: 'chunked',
          variableComboChunks: 1,
          frequencyChunks: 1,
          storedAt: '2026-05-26T00:00:00.000Z'
        }
      })
    );
    cacheService.get
      .mockResolvedValueOnce({
        storage: 'chunked',
        workspaceId: 1,
        total: 1,
        variableComboChunks: 1,
        frequencyChunks: 1,
        storedAt: '2026-05-26T00:00:00.000Z'
      });

    await expect(service.getAnalysisResults('job-1', 1)).rejects.toThrow(
      'stored in chunks'
    );
  });

  it('returns one filtered page from chunked cached results', async () => {
    jobQueueService.getVariableAnalysisJob.mockResolvedValue(
      createJob({
        returnvalue: {
          cacheKey: 'variable-analysis:1:job-1',
          workspaceId: 1,
          total: 3,
          storage: 'chunked',
          variableComboChunks: 1,
          frequencyChunks: 1,
          storedAt: '2026-05-26T00:00:00.000Z'
        }
      })
    );
    cacheService.get
      .mockResolvedValueOnce({
        storage: 'chunked',
        workspaceId: 1,
        total: 3,
        variableComboChunks: 1,
        frequencyChunks: 1,
        storedAt: '2026-05-26T00:00:00.000Z'
      })
      .mockResolvedValueOnce([
        {
          unitId: 1,
          unitName: 'UNIT_A',
          variableId: 'VAR_EMPTY',
          totalCount: 10,
          emptyCount: 2,
          emptyPercentage: 20,
          distinctValueCount: 2,
          statusCounts: []
        },
        {
          unitId: 2,
          unitName: 'UNIT_B',
          variableId: 'VAR_FULL',
          totalCount: 10,
          emptyCount: 0,
          emptyPercentage: 0,
          distinctValueCount: 1,
          statusCounts: []
        },
        {
          unitId: 3,
          unitName: 'OTHER',
          variableId: 'VAR_EMPTY_2',
          totalCount: 10,
          emptyCount: 1,
          emptyPercentage: 10,
          distinctValueCount: 2,
          statusCounts: []
        }
      ])
      .mockResolvedValueOnce([
        [
          '1:VAR_EMPTY',
          [
            {
              unitId: 1,
              unitName: 'UNIT_A',
              variableId: 'VAR_EMPTY',
              value: '',
              count: 2,
              percentage: 20
            }
          ]
        ],
        [
          '2:VAR_FULL',
          [
            {
              unitId: 2,
              unitName: 'UNIT_B',
              variableId: 'VAR_FULL',
              value: 'x',
              count: 10,
              percentage: 100
            }
          ]
        ],
        [
          '3:VAR_EMPTY_2',
          [
            {
              unitId: 3,
              unitName: 'OTHER',
              variableId: 'VAR_EMPTY_2',
              value: '',
              count: 1,
              percentage: 10
            }
          ]
        ]
      ]);

    await expect(
      service.getAnalysisResultsPage('job-1', 1, {
        page: 1,
        pageSize: 1,
        search: 'UNIT',
        onlyEmpty: true
      })
    ).resolves.toMatchObject({
      variableCombos: [expect.objectContaining({ unitName: 'UNIT_A' })],
      frequencies: {
        '1:VAR_EMPTY': [expect.objectContaining({ value: '' })]
      },
      total: 1,
      rowTotal: 1,
      rows: [expect.objectContaining({ unitName: 'UNIT_A', value: '' })],
      unfilteredTotal: 3,
      page: 1,
      pageSize: 1,
      totalPages: 1
    });
  });

  it('sorts flattened result rows before paginating', async () => {
    jobQueueService.getVariableAnalysisJob.mockResolvedValue(
      createJob({
        data: { workspaceId: 1 },
        returnvalue: {
          variableCombos: [
            {
              unitId: 1,
              unitName: 'UNIT',
              variableId: 'VAR',
              totalCount: 10,
              emptyCount: 0,
              emptyPercentage: 0,
              distinctValueCount: 2,
              statusCounts: []
            }
          ],
          frequencies: {
            '1:VAR': [
              {
                unitId: 1,
                unitName: 'UNIT',
                variableId: 'VAR',
                value: 'low',
                count: 2,
                percentage: 20
              },
              {
                unitId: 1,
                unitName: 'UNIT',
                variableId: 'VAR',
                value: 'high',
                count: 8,
                percentage: 80
              }
            ]
          },
          total: 1
        }
      })
    );

    await expect(
      service.getAnalysisResultsPage('job-1', 1, {
        page: 1,
        pageSize: 1,
        sortBy: 'count',
        sortDirection: 'desc'
      })
    ).resolves.toMatchObject({
      rows: [expect.objectContaining({ value: 'high', count: 8 })],
      rowTotal: 2,
      totalPages: 2
    });
  });

  it('keeps missing sort values last when sorting rows descending', async () => {
    jobQueueService.getVariableAnalysisJob.mockResolvedValue(
      createJob({
        data: { workspaceId: 1 },
        returnvalue: {
          variableCombos: [
            {
              unitId: 1,
              unitName: 'UNIT',
              variableId: 'VAR',
              totalCount: 3,
              emptyCount: 0,
              emptyPercentage: 0,
              distinctValueCount: 3,
              statusCounts: []
            }
          ],
          frequencies: {
            '1:VAR': [
              {
                unitId: 1,
                unitName: 'UNIT',
                variableId: 'VAR',
                value: 'missing',
                count: 1,
                percentage: 33.3
              },
              {
                unitId: 1,
                unitName: 'UNIT',
                variableId: 'VAR',
                value: 'alpha',
                label: 'Alpha',
                count: 1,
                percentage: 33.3
              },
              {
                unitId: 1,
                unitName: 'UNIT',
                variableId: 'VAR',
                value: 'beta',
                label: 'Beta',
                count: 1,
                percentage: 33.3
              }
            ]
          },
          total: 1
        }
      })
    );

    const page = await service.getAnalysisResultsPage('job-1', 1, {
      sortBy: 'label',
      sortDirection: 'desc'
    });

    expect(page.rows?.map(row => row.value)).toEqual([
      'beta',
      'alpha',
      'missing'
    ]);
  });

  it('sorts chunked rows before returning a bounded result page', async () => {
    const manifest = {
      storage: 'chunked',
      workspaceId: 1,
      total: 2,
      variableComboChunks: 1,
      frequencyChunks: 1,
      storedAt: '2026-05-26T00:00:00.000Z'
    };
    const variableCombos = [
      {
        unitId: 1,
        unitName: 'UNIT_A',
        variableId: 'VAR_A',
        totalCount: 10,
        emptyCount: 0,
        emptyPercentage: 0,
        distinctValueCount: 2,
        statusCounts: []
      },
      {
        unitId: 2,
        unitName: 'UNIT_B',
        variableId: 'VAR_B',
        totalCount: 10,
        emptyCount: 0,
        emptyPercentage: 0,
        distinctValueCount: 2,
        statusCounts: []
      }
    ];
    const frequencyChunks = [
      [
        '1:VAR_A',
        [
          {
            unitId: 1,
            unitName: 'UNIT_A',
            variableId: 'VAR_A',
            value: 'middle',
            count: 5,
            percentage: 50
          },
          {
            unitId: 1,
            unitName: 'UNIT_A',
            variableId: 'VAR_A',
            value: 'low',
            count: 1,
            percentage: 10
          }
        ]
      ],
      [
        '2:VAR_B',
        [
          {
            unitId: 2,
            unitName: 'UNIT_B',
            variableId: 'VAR_B',
            value: 'high',
            count: 8,
            percentage: 80
          },
          {
            unitId: 2,
            unitName: 'UNIT_B',
            variableId: 'VAR_B',
            value: 'lowest',
            count: 0,
            percentage: 0
          }
        ]
      ]
    ];
    jobQueueService.getVariableAnalysisJob.mockResolvedValue(createJob());
    cacheService.get
      .mockResolvedValueOnce(manifest)
      .mockResolvedValueOnce(variableCombos)
      .mockResolvedValueOnce(frequencyChunks);

    const page = await service.getAnalysisResultsPage('job-1', 1, {
      page: 1,
      pageSize: 2,
      sortBy: 'count',
      sortDirection: 'desc'
    });

    expect(page.rows?.map(row => row.value)).toEqual(['high', 'middle']);
    expect(page.rowTotal).toBe(4);
    expect(page.totalPages).toBe(2);
    expect(Object.values(page.frequencies).flat()).toHaveLength(2);
  });

  it('caps the pageable chunked row window for deep sorted pages', async () => {
    Object.defineProperty(service, 'MAX_SORTED_PAGE_WINDOW_ROWS', {
      value: 2
    });
    const manifest = {
      storage: 'chunked',
      workspaceId: 1,
      total: 2,
      variableComboChunks: 1,
      frequencyChunks: 1,
      storedAt: '2026-05-26T00:00:00.000Z'
    };
    const variableCombos = [
      {
        unitId: 1,
        unitName: 'UNIT_A',
        variableId: 'VAR_A',
        totalCount: 10,
        emptyCount: 0,
        emptyPercentage: 0,
        distinctValueCount: 2,
        statusCounts: []
      },
      {
        unitId: 2,
        unitName: 'UNIT_B',
        variableId: 'VAR_B',
        totalCount: 10,
        emptyCount: 0,
        emptyPercentage: 0,
        distinctValueCount: 2,
        statusCounts: []
      }
    ];
    const frequencyChunks = [
      [
        '1:VAR_A',
        [
          {
            unitId: 1,
            unitName: 'UNIT_A',
            variableId: 'VAR_A',
            value: 'middle',
            count: 5,
            percentage: 50
          },
          {
            unitId: 1,
            unitName: 'UNIT_A',
            variableId: 'VAR_A',
            value: 'low',
            count: 1,
            percentage: 10
          }
        ]
      ],
      [
        '2:VAR_B',
        [
          {
            unitId: 2,
            unitName: 'UNIT_B',
            variableId: 'VAR_B',
            value: 'high',
            count: 8,
            percentage: 80
          },
          {
            unitId: 2,
            unitName: 'UNIT_B',
            variableId: 'VAR_B',
            value: 'lowest',
            count: 0,
            percentage: 0
          }
        ]
      ]
    ];
    jobQueueService.getVariableAnalysisJob.mockResolvedValue(createJob());
    cacheService.get
      .mockResolvedValueOnce(manifest)
      .mockResolvedValueOnce(variableCombos)
      .mockResolvedValueOnce(frequencyChunks);

    const page = await service.getAnalysisResultsPage('job-1', 1, {
      page: 3,
      pageSize: 2,
      sortBy: 'count',
      sortDirection: 'desc'
    });

    expect(page.page).toBe(1);
    expect(page.maxPage).toBe(1);
    expect(page.rowTotal).toBe(4);
    expect(page.pageableRowTotal).toBe(2);
    expect(page.totalPages).toBe(1);
    expect(page.rows?.map(row => row.value)).toEqual(['high', 'middle']);
  });

  it('applies schema code visibility to chunked cached result pages', async () => {
    const manifest = {
      storage: 'chunked',
      workspaceId: 1,
      total: 1,
      variableComboChunks: 1,
      frequencyChunks: 1,
      storedAt: '2026-05-26T00:00:00.000Z'
    };
    const variableCombos = [
      {
        unitId: 1,
        unitName: 'UNIT',
        variableId: 'VAR',
        totalCount: 4,
        emptyCount: 0,
        emptyPercentage: 0,
        distinctValueCount: 3,
        statusCounts: []
      }
    ];
    const frequencyChunks = [
      [
        '1:VAR',
        [
          {
            unitId: 1,
            unitName: 'UNIT',
            variableId: 'VAR',
            value: 'Z',
            count: 2,
            percentage: 50
          },
          {
            unitId: 1,
            unitName: 'UNIT',
            variableId: 'VAR',
            value: 'A',
            label: 'Alpha',
            schemaOrder: 0,
            count: 1,
            percentage: 25
          },
          {
            unitId: 1,
            unitName: 'UNIT',
            variableId: 'VAR',
            value: 'B',
            label: 'Beta',
            schemaOrder: 1,
            isSchemaOnly: true,
            isSchemaSupplemental: true,
            count: 0,
            percentage: 0
          }
        ]
      ]
    ];
    jobQueueService.getVariableAnalysisJob.mockResolvedValue(
      createJob({
        returnvalue: manifest
      })
    );
    cacheService.get
      .mockResolvedValueOnce(manifest)
      .mockResolvedValueOnce(variableCombos)
      .mockResolvedValueOnce(frequencyChunks)
      .mockResolvedValueOnce(manifest)
      .mockResolvedValueOnce(variableCombos)
      .mockResolvedValueOnce(frequencyChunks);

    await expect(
      service.getAnalysisResultsPage('job-1', 1, {
        page: 1,
        pageSize: 10
      })
    ).resolves.toMatchObject({
      frequencies: {
        '1:VAR': [
          { value: 'A' },
          { value: 'Z' }
        ]
      }
    });

    await expect(
      service.getAnalysisResultsPage('job-1', 1, {
        page: 1,
        pageSize: 10,
        includeSchemaCodes: true
      })
    ).resolves.toMatchObject({
      frequencies: {
        '1:VAR': [
          { value: 'A' },
          { value: 'B', count: 0 },
          { value: 'Z' }
        ]
      }
    });
  });

  it('keeps chunked variables visible when default schema filtering leaves no frequency rows', async () => {
    const manifest = {
      storage: 'chunked',
      workspaceId: 1,
      total: 1,
      variableComboChunks: 1,
      frequencyChunks: 1,
      storedAt: '2026-05-26T00:00:00.000Z'
    };
    const variableCombos = [
      {
        unitId: 1,
        unitName: 'UNIT',
        variableId: 'MISSING',
        totalCount: 0,
        emptyCount: 0,
        emptyPercentage: 0,
        distinctValueCount: 0,
        statusCounts: []
      }
    ];
    const frequencyChunks = [
      [
        '1:MISSING',
        [
          {
            unitId: 1,
            unitName: 'UNIT',
            variableId: 'MISSING',
            value: 'Z',
            label: 'Zed',
            schemaOrder: 0,
            isSchemaOnly: true,
            isSchemaSupplemental: true,
            count: 0,
            percentage: 0
          }
        ]
      ]
    ];
    jobQueueService.getVariableAnalysisJob.mockResolvedValue(
      createJob({
        returnvalue: manifest
      })
    );
    cacheService.get
      .mockResolvedValueOnce(manifest)
      .mockResolvedValueOnce(variableCombos)
      .mockResolvedValueOnce(frequencyChunks);

    const page = await service.getAnalysisResultsPage('job-1', 1, {
      page: 1,
      pageSize: 10
    });

    expect(page).toMatchObject({
      variableCombos: [expect.objectContaining({ variableId: 'MISSING' })],
      frequencies: {
        '1:MISSING': [
          expect.objectContaining({
            value: '',
            count: 0,
            percentage: 0,
            isSchemaOnly: true
          })
        ]
      },
      total: 1,
      rowTotal: 1,
      rows: [
        expect.objectContaining({
          unitName: 'UNIT',
          variableId: 'MISSING',
          value: '',
          count: 0,
          totalCount: 0
        })
      ]
    });
  });

  it('exports filtered chunked cached results as formula-safe CSV', async () => {
    jobQueueService.getVariableAnalysisJob.mockResolvedValue(
      createJob({
        returnvalue: {
          cacheKey: 'variable-analysis:1:job-1',
          workspaceId: 1,
          total: 2,
          storage: 'chunked',
          variableComboChunks: 1,
          frequencyChunks: 1,
          storedAt: '2026-05-26T00:00:00.000Z'
        }
      })
    );
    cacheService.get
      .mockResolvedValueOnce({
        storage: 'chunked',
        workspaceId: 1,
        total: 2,
        variableComboChunks: 1,
        frequencyChunks: 1,
        storedAt: '2026-05-26T00:00:00.000Z'
      })
      .mockResolvedValueOnce([
        {
          unitId: 1,
          unitName: '=UNIT',
          variableId: '+VAR',
          totalCount: 10,
          emptyCount: 2,
          emptyPercentage: 20,
          distinctValueCount: 2,
          statusCounts: [
            { status: 3, count: 8, percentage: 80 },
            { status: 8, count: 2, percentage: 20 }
          ]
        },
        {
          unitId: 2,
          unitName: 'OTHER',
          variableId: 'VAR_FULL',
          totalCount: 5,
          emptyCount: 0,
          emptyPercentage: 0,
          distinctValueCount: 1,
          statusCounts: []
        }
      ])
      .mockResolvedValueOnce([
        [
          '1:+VAR',
          [
            {
              unitId: 1,
              unitName: '=UNIT',
              variableId: '+VAR',
              value: '@value',
              count: 8,
              percentage: 80
            },
            {
              unitId: 1,
              unitName: '=UNIT',
              variableId: '+VAR',
              value: '',
              count: 2,
              percentage: 20
            }
          ]
        ],
        [
          '2:VAR_FULL',
          [
            {
              unitId: 2,
              unitName: 'OTHER',
              variableId: 'VAR_FULL',
              value: 'x',
              count: 5,
              percentage: 100
            }
          ]
        ]
      ]);

    const csv = await service.exportAnalysisResultsAsCsv('job-1', 1, {
      search: '=UNIT',
      onlyEmpty: true
    });

    expect(csv).toContain('Unit-ID;Unit-Name;Variablen-ID');
    expect(csv).toContain(";'=UNIT;'+VAR;'@value;");
    expect(csv).toContain('VALUE_CHANGED: 8 (80%)');
    expect(csv).toContain('CODING_INCOMPLETE: 2 (20%)');
    expect(csv).not.toContain('OTHER');
  });

  it('exports variables without visible frequency rows as zero-count rows', async () => {
    const manifest = {
      storage: 'chunked',
      workspaceId: 1,
      total: 1,
      variableComboChunks: 1,
      frequencyChunks: 1,
      storedAt: '2026-05-26T00:00:00.000Z'
    };
    const variableCombos = [
      {
        unitId: 1,
        unitName: 'UNIT',
        variableId: 'MISSING',
        totalCount: 0,
        emptyCount: 0,
        emptyPercentage: 0,
        distinctValueCount: 0,
        statusCounts: []
      }
    ];
    const frequencyChunks = [
      [
        '1:MISSING',
        [
          {
            unitId: 1,
            unitName: 'UNIT',
            variableId: 'MISSING',
            value: 'Z',
            label: 'Zed',
            schemaOrder: 0,
            isSchemaOnly: true,
            isSchemaSupplemental: true,
            count: 0,
            percentage: 0
          }
        ]
      ]
    ];
    jobQueueService.getVariableAnalysisJob.mockResolvedValue(
      createJob({
        returnvalue: manifest
      })
    );
    cacheService.get
      .mockResolvedValueOnce(manifest)
      .mockResolvedValueOnce(variableCombos)
      .mockResolvedValueOnce(frequencyChunks);

    const csv = await service.exportAnalysisResultsAsCsv('job-1', 1);
    const dataLine = csv.split(/\r?\n/).find(line => line.includes('MISSING'));

    expect(dataLine).toBeDefined();
    expect(dataLine).toContain('1;UNIT;MISSING;');
    expect(dataLine?.split(';').slice(5, 13)).toEqual([
      'ja',
      '0',
      '0',
      '0',
      '',
      '0',
      '0',
      '0'
    ]);
  });

  it('exports direct cached results as XLSX with typed numeric columns', async () => {
    jobQueueService.getVariableAnalysisJob.mockResolvedValue(
      createJob({
        data: { workspaceId: 1 },
        returnvalue: {
          variableCombos: [
            {
              unitId: 1,
              unitName: 'UNIT',
              variableId: 'VAR',
              totalCount: 10,
              validCount: 10,
              invalidCount: 0,
              emptyCount: 0,
              emptyPercentage: 0,
              distinctValueCount: 1,
              statusCounts: [{ status: 5, count: 10, percentage: 100 }]
            }
          ],
          frequencies: {
            '1:VAR': [
              {
                unitId: 1,
                unitName: 'UNIT',
                variableId: 'VAR',
                value: '=kept-as-text',
                count: 10,
                validOccurrenceCount: 10,
                percentage: 100,
                percentageTotal: 100,
                percentageValid: 100
              }
            ]
          },
          total: 1
        }
      })
    );

    const xlsx = await service.exportAnalysisResultsAsXlsx('job-1', 1);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx);
    const worksheet = workbook.getWorksheet('Antwortwerte');

    expect(worksheet).toBeDefined();
    expect(worksheet?.getRow(1).getCell(1).value).toBe('Unit-ID');
    expect(worksheet?.getRow(2).getCell(2).value).toBe('UNIT');
    expect(worksheet?.getRow(2).getCell(4).value).toBe('=kept-as-text');
    expect(worksheet?.getRow(2).getCell(7).value).toBe(10);
    expect(worksheet?.getRow(2).getCell(8).value).toBe(10);
    expect(worksheet?.getRow(2).getCell(9).value).toBe(100);
    expect(worksheet?.getRow(2).getCell(10).value).toBe(100);
    expect(worksheet?.getRow(2).getCell(11).value).toBe(10);
    expect(worksheet?.getRow(2).getCell(12).value).toBe(10);
    expect(worksheet?.getRow(2).getCell(13).value).toBe(0);
    expect(worksheet?.getColumn(9).numFmt).toBe('0.0');
    expect(worksheet?.getColumn(10).numFmt).toBe('0.0');
  });

  it('hides supplemental schema code rows by default and includes them on request', async () => {
    const result = {
      variableCombos: [
        {
          unitId: 1,
          unitName: 'UNIT',
          variableId: 'VAR',
          totalCount: 4,
          emptyCount: 0,
          emptyPercentage: 0,
          distinctValueCount: 3,
          statusCounts: []
        }
      ],
      frequencies: {
        '1:VAR': [
          {
            unitId: 1,
            unitName: 'UNIT',
            variableId: 'VAR',
            value: 'Z',
            count: 2,
            percentage: 50
          },
          {
            unitId: 1,
            unitName: 'UNIT',
            variableId: 'VAR',
            value: 'A',
            label: 'Alpha',
            schemaOrder: 0,
            count: 1,
            percentage: 25
          },
          {
            unitId: 1,
            unitName: 'UNIT',
            variableId: 'VAR',
            value: 'B',
            label: 'Beta',
            schemaOrder: 1,
            isSchemaOnly: true,
            isSchemaSupplemental: true,
            count: 0,
            percentage: 0
          }
        ]
      },
      total: 1
    };
    jobQueueService.getVariableAnalysisJob
      .mockResolvedValueOnce(createJob({
        data: { workspaceId: 1 },
        returnvalue: result
      }))
      .mockResolvedValueOnce(createJob({
        data: { workspaceId: 1 },
        returnvalue: result
      }));

    await expect(
      service.getAnalysisResultsPage('job-1', 1)
    ).resolves.toMatchObject({
      frequencies: {
        '1:VAR': [
          { value: 'A' },
          { value: 'Z' }
        ]
      }
    });

    await expect(
      service.getAnalysisResultsPage('job-1', 1, {
        includeSchemaCodes: true
      })
    ).resolves.toMatchObject({
      frequencies: {
        '1:VAR': [
          { value: 'A' },
          { value: 'B' },
          { value: 'Z' }
        ]
      }
    });
  });

  it('lists, deletes and cancels jobs', async () => {
    jobQueueService.getVariableAnalysisJobs.mockResolvedValue([
      createJob({ id: 'newer', state: 'active' }),
      createJob({ id: 'older', state: 'completed' })
    ]);
    jobQueueService.getVariableAnalysisJob.mockResolvedValue(createJob());
    jobQueueService.deleteVariableAnalysisJob.mockResolvedValue(true);
    jobQueueService.cancelVariableAnalysisJob.mockResolvedValue(true);
    jobQueueService.deleteVariableAnalysisJobs.mockResolvedValue(undefined);

    const jobs = await service.getAnalysisJobs(1);
    expect(jobs).toHaveLength(2);
    expect(jobs[0].status).toBe('processing');
    await expect(service.deleteJob(1, 'job-1')).resolves.toBe(true);
    expect(cacheService.delete).toHaveBeenCalledWith(
      'variable-analysis:1:job-1'
    );
    await expect(service.cancelJob(1, 'job-1')).resolves.toBe(true);
    await expect(service.deleteAllJobs(1)).resolves.toBeUndefined();
  });
});
