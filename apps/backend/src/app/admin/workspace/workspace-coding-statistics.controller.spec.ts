import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { WorkspaceCodingStatisticsController } from './workspace-coding-statistics.controller';

describe('WorkspaceCodingStatisticsController', () => {
  let codingStatisticsService: { calculateCohensKappa: jest.Mock };
  let codingJobService: { createDistributedCodingJobs: jest.Mock };
  let codingReviewService: {
    getDoubleCodedVariablesForReview: jest.Mock;
    getCodedVariablesForKappa: jest.Mock;
  };
  let codingReadinessService: { getReadiness: jest.Mock };
  let controller: WorkspaceCodingStatisticsController;

  beforeEach(() => {
    codingStatisticsService = {
      calculateCohensKappa: jest.fn()
    };
    codingJobService = {
      createDistributedCodingJobs: jest.fn().mockResolvedValue({
        success: true,
        jobsCreated: 0,
        message: 'ok',
        distribution: {},
        doubleCodingInfo: {},
        jobs: []
      })
    };
    codingReviewService = {
      getDoubleCodedVariablesForReview: jest.fn(),
      getCodedVariablesForKappa: jest.fn().mockResolvedValue([])
    };
    codingReadinessService = {
      getReadiness: jest.fn().mockResolvedValue({
        workspaceId: 5,
        autoCoderRun: 1,
        readiness: 'READY',
        blockers: [],
        rawResponsesTotal: 0,
        rawResponsesWithRelevantStatus: 0,
        resultUnitsTotal: 0,
        resultUnitKeysTotal: 0,
        matchedUnitFiles: 0,
        missingUnitFiles: [],
        matchedCodingSchemes: 0,
        missingCodingSchemes: [],
        invalidCodingSchemes: [],
        validVariablePairs: 0,
        validResponses: 0,
        codeableResponses: 0,
        invalidVariableSamples: []
      })
    };

    controller = new WorkspaceCodingStatisticsController(
      codingStatisticsService as never,
      codingJobService as never,
      {} as never,
      {} as never,
      codingReviewService as never,
      {} as never,
      {} as never,
      codingReadinessService as never,
      {} as never
    );
  });

  it('rejects job definition ids on the generic distributed job endpoint', async () => {
    await expect(controller.createDistributedCodingJobs(5, {
      selectedVariables: [],
      selectedCoders: [],
      jobDefinitionId: 42
    } as never)).rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobService.createDistributedCodingJobs).not.toHaveBeenCalled();
  });

  it('rejects generic distributed job requests without a request body', async () => {
    await expect(controller.createDistributedCodingJobs(5, undefined as never))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobService.createDistributedCodingJobs).not.toHaveBeenCalled();
  });

  it('delegates generic distributed job requests without job definition ids', async () => {
    const body = {
      selectedVariables: [{ unitName: 'UNIT', variableId: 'VAR' }],
      selectedCoders: [{ id: 1, name: 'Coder', username: 'coder' }]
    };

    await controller.createDistributedCodingJobs(5, body);

    expect(codingJobService.createDistributedCodingJobs).toHaveBeenCalledWith(5, body);
  });

  it('delegates autocoding readiness requests with parsed options', async () => {
    await controller.getAutocodingReadiness(5, '2', 'true');

    expect(codingReadinessService.getReadiness).toHaveBeenCalledWith(5, {
      autoCoderRun: 2,
      forceRefresh: true
    });
  });

  it('adds weighted mean kappa per variable to detailed kappa statistics', async () => {
    codingReviewService.getCodedVariablesForKappa.mockResolvedValue([
      {
        unitName: 'UNIT',
        variableId: 'VAR',
        personLogin: 'p1',
        personCode: 'P1',
        coderResults: [
          {
            coderId: 1,
            coderName: 'Coder 1',
            jobId: 11,
            code: 1,
            score: null,
            notes: null,
            codedAt: new Date()
          },
          {
            coderId: 2,
            coderName: 'Coder 2',
            jobId: 12,
            code: 1,
            score: null,
            notes: null,
            codedAt: new Date()
          },
          {
            coderId: 3,
            coderName: 'Coder 3',
            jobId: 13,
            code: 2,
            score: null,
            notes: null,
            codedAt: new Date()
          }
        ]
      },
      {
        unitName: 'UNIT',
        variableId: 'VAR',
        personLogin: 'p2',
        personCode: 'P2',
        coderResults: [
          {
            coderId: 1,
            coderName: 'Coder 1',
            jobId: 14,
            code: 1,
            score: null,
            notes: null,
            codedAt: new Date()
          }
        ]
      }
    ]);
    codingStatisticsService.calculateCohensKappa.mockReturnValue([
      {
        coder1Id: 1,
        coder1Name: 'Coder 1',
        coder2Id: 2,
        coder2Name: 'Coder 2',
        kappa: 0.5,
        agreement: 0.75,
        totalItems: 10,
        validPairs: 10,
        interpretation: 'kappa.moderate'
      },
      {
        coder1Id: 1,
        coder1Name: 'Coder 1',
        coder2Id: 3,
        coder2Name: 'Coder 3',
        kappa: 1,
        agreement: 1,
        totalItems: 5,
        validPairs: 5,
        interpretation: 'kappa.almost_perfect'
      },
      {
        coder1Id: 2,
        coder1Name: 'Coder 2',
        coder2Id: 3,
        coder2Name: 'Coder 3',
        kappa: null,
        agreement: 0,
        totalItems: 5,
        validPairs: 0,
        interpretation: 'No valid coding pairs'
      }
    ]);

    const result = await controller.getCohensKappaStatistics(
      5,
      'true',
      undefined,
      undefined,
      'false'
    );

    expect(result.variables[0].meanKappa).toBe(0.667);
    expect(result.variables[0].meanAgreement).toBe(0.833);
    expect(result.variables[0].caseCount).toBe(2);
    expect(result.variables[0].doubleCodedCount).toBe(1);
    expect(result.variables[0].doubleCodedRate).toBe(0.5);
    expect(result.variables[0].validPairCount).toBe(15);
    expect(result.variables[0].coderPairCount).toBe(2);
    expect(result.workspaceSummary.averageKappa).toBe(0.667);
    expect(result.workspaceSummary.meanAgreement).toBe(0.833);
    expect(result.workspaceSummary.totalCodedResponses).toBe(2);
    expect(result.workspaceSummary.totalDoubleCodedResponses).toBe(1);
    expect(
      codingReviewService.getCodedVariablesForKappa
    ).toHaveBeenCalledWith(5, false);
  });

  it('adds unweighted mean kappa per variable to detailed kappa statistics', async () => {
    codingReviewService.getCodedVariablesForKappa.mockResolvedValue([{
      unitName: 'UNIT',
      variableId: 'VAR',
      personLogin: 'p1',
      personCode: 'P1',
      coderResults: [
        {
          coderId: 1,
          coderName: 'Coder 1',
          jobId: 11,
          code: 1,
          score: null,
          notes: null,
          codedAt: new Date()
        },
        {
          coderId: 2,
          coderName: 'Coder 2',
          jobId: 12,
          code: 1,
          score: null,
          notes: null,
          codedAt: new Date()
        },
        {
          coderId: 3,
          coderName: 'Coder 3',
          jobId: 13,
          code: 2,
          score: null,
          notes: null,
          codedAt: new Date()
        }
      ]
    }]);
    codingStatisticsService.calculateCohensKappa.mockReturnValue([
      {
        coder1Id: 1,
        coder1Name: 'Coder 1',
        coder2Id: 2,
        coder2Name: 'Coder 2',
        kappa: 0.5,
        agreement: 0.75,
        totalItems: 10,
        validPairs: 10,
        interpretation: 'kappa.moderate'
      },
      {
        coder1Id: 1,
        coder1Name: 'Coder 1',
        coder2Id: 3,
        coder2Name: 'Coder 3',
        kappa: 1,
        agreement: 1,
        totalItems: 5,
        validPairs: 5,
        interpretation: 'kappa.almost_perfect'
      },
      {
        coder1Id: 2,
        coder1Name: 'Coder 2',
        coder2Id: 3,
        coder2Name: 'Coder 3',
        kappa: null,
        agreement: 0,
        totalItems: 5,
        validPairs: 0,
        interpretation: 'No valid coding pairs'
      }
    ]);

    const result = await controller.getCohensKappaStatistics(5, 'false');

    expect(result.variables[0].meanKappa).toBe(0.75);
    expect(result.variables[0].meanAgreement).toBe(0.875);
    expect(result.workspaceSummary.averageKappa).toBe(0.75);
    expect(result.workspaceSummary.meanAgreement).toBe(0.875);
  });

  it('exports detailed kappa coder-pair statistics as CSV with filters and scope metadata', async () => {
    codingReviewService.getCodedVariablesForKappa.mockResolvedValue([{
      unitName: 'UNIT',
      variableId: 'VAR',
      personLogin: 'p1',
      personCode: 'P1',
      coderResults: [
        {
          coderId: 1,
          coderName: 'Coder 1',
          jobId: 11,
          jobName: 'Coding Job A',
          jobDefinitionId: 21,
          trainingId: null,
          trainingLabel: null,
          code: 1,
          score: null,
          notes: null,
          codedAt: new Date()
        },
        {
          coderId: 2,
          coderName: 'Coder 2',
          jobId: 12,
          jobName: 'Training Job B',
          jobDefinitionId: null,
          trainingId: 31,
          trainingLabel: 'Training Alpha',
          code: 1,
          score: null,
          notes: null,
          codedAt: new Date()
        }
      ]
    }]);
    codingStatisticsService.calculateCohensKappa.mockReturnValue([
      {
        coder1Id: 1,
        coder1Name: 'Coder 1',
        coder2Id: 2,
        coder2Name: 'Coder 2',
        kappa: 0.8,
        agreement: 0.9,
        totalItems: 10,
        validPairs: 9,
        interpretation: 'kappa.substantial'
      }
    ]);
    const response = {
      setHeader: jest.fn(),
      send: jest.fn()
    };

    await controller.exportCohensKappaStatisticsAsCsv(
      5,
      'false',
      'UNIT',
      'VAR',
      'false',
      response as never
    );

    expect(codingReviewService.getCodedVariablesForKappa)
      .toHaveBeenCalledWith(5, false);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8'
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('cohens-kappa-details-5-')
    );
    const csv = response.send.mock.calls[0][0] as string;
    expect(csv).toContain('Variable;Unit;Variablen-ID');
    expect(csv).toContain('UNIT - VAR');
    expect(csv).toContain('Job-Definitionen: 21; Trainings: Training Alpha');
    expect(csv).toContain('Coding Job A, Training Job B');
    expect(csv).toContain('ungewichteter Mittelwert');
    expect(csv).toContain(';nein;');
  });

  it('sanitizes formula-like text values in the detailed kappa CSV export', async () => {
    codingReviewService.getCodedVariablesForKappa.mockResolvedValue([{
      unitName: '=UNIT',
      variableId: '+VAR',
      personLogin: 'p1',
      personCode: 'P1',
      coderResults: [
        {
          coderId: 1,
          coderName: '=Coder 1',
          jobId: 11,
          jobName: '@Coding Job',
          jobDefinitionId: 21,
          trainingId: null,
          trainingLabel: null,
          code: 1,
          score: null,
          notes: null,
          codedAt: new Date()
        },
        {
          coderId: 2,
          coderName: '-Coder 2',
          jobId: 12,
          jobName: 'Training Job B',
          jobDefinitionId: null,
          trainingId: 31,
          trainingLabel: '=Training Alpha',
          code: 1,
          score: null,
          notes: null,
          codedAt: new Date()
        }
      ]
    }]);
    codingStatisticsService.calculateCohensKappa.mockReturnValue([
      {
        coder1Id: 1,
        coder1Name: '=Coder 1',
        coder2Id: 2,
        coder2Name: '-Coder 2',
        kappa: 0.8,
        agreement: 0.9,
        totalItems: 10,
        validPairs: 9,
        interpretation: 'kappa.substantial'
      }
    ]);
    const response = {
      setHeader: jest.fn(),
      send: jest.fn()
    };

    await controller.exportCohensKappaStatisticsAsCsv(
      5,
      'true',
      '=UNIT',
      '+VAR',
      'true',
      response as never
    );

    const csv = response.send.mock.calls[0][0] as string;
    expect(csv).toContain("'=UNIT - +VAR");
    expect(csv).toContain(";'=UNIT;");
    expect(csv).toContain(";'+VAR;");
    expect(csv).toContain("'@Coding Job");
    expect(csv).toContain("'=Training Alpha");
    expect(csv).toContain(";'=Coder 1;");
    expect(csv).toContain(";'-Coder 2;");
    expect(csv).toContain(";'=UNIT;'+VAR;");
  });

  it('exports kappa variable summary as CSV using the reference-like columns', async () => {
    codingReviewService.getCodedVariablesForKappa.mockResolvedValue([
      {
        unitName: 'UNIT',
        variableId: 'VAR',
        personLogin: 'p1',
        personCode: 'P1',
        personGroup: 'G1',
        coderResults: [
          {
            coderId: 1,
            coderName: 'Coder 1',
            jobId: 11,
            jobName: 'Coding Job A',
            code: 1,
            score: null,
            notes: null,
            codedAt: new Date()
          },
          {
            coderId: 2,
            coderName: 'Coder 2',
            jobId: 12,
            jobName: 'Coding Job B',
            code: 1,
            score: null,
            notes: null,
            codedAt: new Date()
          }
        ]
      },
      {
        unitName: 'UNIT',
        variableId: 'VAR',
        personLogin: 'p2',
        personCode: 'P2',
        personGroup: 'G1',
        coderResults: [
          {
            coderId: 1,
            coderName: 'Coder 1',
            jobId: 13,
            jobName: 'Coding Job C',
            code: 1,
            score: null,
            notes: null,
            codedAt: new Date()
          }
        ]
      }
    ]);
    codingStatisticsService.calculateCohensKappa.mockReturnValue([
      {
        coder1Id: 1,
        coder1Name: 'Coder 1',
        coder2Id: 2,
        coder2Name: 'Coder 2',
        kappa: 0.8,
        agreement: 0.9,
        totalItems: 1,
        validPairs: 1,
        interpretation: 'kappa.substantial'
      }
    ]);
    const response = {
      setHeader: jest.fn(),
      send: jest.fn()
    };

    await controller.exportCohensKappaSummaryAsCsv(
      5,
      'true',
      undefined,
      undefined,
      'true',
      response as never
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('cohens-kappa-summary-5-')
    );
    const csv = response.send.mock.calls[0][0] as string;
    expect(csv).toContain('subunit;nCases;nDop;percDop;meankappa;meanagree');
    expect(csv).toContain('UNIT_VAR;2;1;50;0.8;0.9');
  });

  it('exports kappa workbook with summary, pairwise and coding result sheets', async () => {
    codingReviewService.getCodedVariablesForKappa.mockResolvedValue([
      {
        unitName: 'UNIT',
        variableId: 'VAR',
        personLogin: 'p1',
        personCode: 'P1',
        personGroup: 'G1',
        coderResults: [
          {
            coderId: 1,
            coderName: 'Coder 1',
            jobId: 11,
            jobName: 'Coding Job A',
            code: 1,
            score: 1,
            notes: 'ok',
            codedAt: new Date()
          },
          {
            coderId: 2,
            coderName: 'Coder 2',
            jobId: 12,
            jobName: 'Coding Job B',
            code: 2,
            score: 0,
            notes: null,
            codedAt: new Date()
          }
        ]
      },
      {
        unitName: 'UNIT',
        variableId: 'VAR',
        personLogin: 'p2',
        personCode: 'P2',
        personGroup: 'G1',
        coderResults: [
          {
            coderId: 1,
            coderName: 'Coder 1',
            jobId: 13,
            jobName: 'Coding Job C',
            code: 1,
            score: 1,
            notes: null,
            codedAt: new Date()
          }
        ]
      }
    ]);
    codingStatisticsService.calculateCohensKappa.mockReturnValue([
      {
        coder1Id: 1,
        coder1Name: 'Coder 1',
        coder2Id: 2,
        coder2Name: 'Coder 2',
        kappa: 0.8,
        agreement: 0.9,
        totalItems: 1,
        validPairs: 1,
        interpretation: 'kappa.substantial'
      }
    ]);
    const response = {
      setHeader: jest.fn(),
      send: jest.fn()
    };

    await controller.exportCohensKappaStatisticsAsXlsx(
      5,
      'true',
      undefined,
      undefined,
      'true',
      response as never
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.send.mock.calls[0][0] as Buffer);

    const summarySheet = workbook.getWorksheet('Übereinstimmung_gesamt');
    const pairwiseSheet = workbook.getWorksheet('Übereinstimmung_paarweise');
    const codingResultsSheet = workbook.getWorksheet('Kodierergebnisse');

    expect(summarySheet?.getRow(1).values).toEqual([
      undefined,
      'subunit',
      'nCases',
      'nDop',
      'percDop',
      'meankappa',
      'meanagree'
    ]);
    expect(summarySheet?.getRow(2).getCell(1).value).toBe('UNIT_VAR');
    expect(summarySheet?.getRow(2).getCell(2).value).toBe(2);
    expect(summarySheet?.getRow(2).getCell(3).value).toBe(1);
    expect(summarySheet?.getRow(2).getCell(4).value).toBe(50);
    expect(pairwiseSheet?.getRow(1).getCell(1).value).toBe('subunit');
    expect(pairwiseSheet?.getRow(2).getCell(5).value).toBe('Coder 1');
    expect(codingResultsSheet?.getRow(1).getCell(1).value).toBe('Test.Person.Login');
    expect(codingResultsSheet?.actualRowCount).toBe(3);
    expect(codingResultsSheet?.getRow(2).getCell(2).value).toBe('G1');
    expect(codingResultsSheet?.getRow(2).getCell(6).value).toBe(1);
    expect(codingResultsSheet?.getRow(2).getCell(8).value).toBe(2);
    expect(codingResultsSheet?.getRow(2).getCell(10).value).toBe('Coder 1: ok');
    expect(codingResultsSheet?.getRow(3).getCell(1).value).toBe('p2');
  });

  it('keeps workbook coding result columns distinct for coders with the same name', async () => {
    codingReviewService.getCodedVariablesForKappa.mockResolvedValue([
      {
        unitName: 'UNIT',
        variableId: 'VAR',
        personLogin: 'p1',
        personCode: 'P1',
        personGroup: 'G1',
        coderResults: [
          {
            coderId: 1,
            coderName: 'Coder',
            jobId: 11,
            jobName: 'Coding Job A',
            code: 1,
            score: 1,
            notes: 'first',
            codedAt: new Date()
          },
          {
            coderId: 2,
            coderName: 'Coder',
            jobId: 12,
            jobName: 'Coding Job B',
            code: 2,
            score: 0,
            notes: 'second',
            codedAt: new Date()
          }
        ]
      }
    ]);
    codingStatisticsService.calculateCohensKappa.mockReturnValue([
      {
        coder1Id: 1,
        coder1Name: 'Coder',
        coder2Id: 2,
        coder2Name: 'Coder',
        kappa: 0,
        agreement: 0,
        totalItems: 1,
        validPairs: 1,
        interpretation: 'kappa.slight'
      }
    ]);
    const response = {
      setHeader: jest.fn(),
      send: jest.fn()
    };

    await controller.exportCohensKappaStatisticsAsXlsx(
      5,
      'true',
      undefined,
      undefined,
      'true',
      response as never
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.send.mock.calls[0][0] as Buffer);

    const codingResultsSheet = workbook.getWorksheet('Kodierergebnisse');

    expect(codingResultsSheet?.getRow(1).getCell(6).value).toBe('Coder (1).Code');
    expect(codingResultsSheet?.getRow(1).getCell(8).value).toBe('Coder (2).Code');
    expect(codingResultsSheet?.getRow(2).getCell(6).value).toBe(1);
    expect(codingResultsSheet?.getRow(2).getCell(8).value).toBe(2);
    expect(codingResultsSheet?.getRow(2).getCell(10).value).toBe('Coder (1): first | Coder (2): second');
  });

  it('keeps workbook coding result columns distinct when disambiguated labels collide with real names', async () => {
    codingReviewService.getCodedVariablesForKappa.mockResolvedValue([
      {
        unitName: 'UNIT',
        variableId: 'VAR',
        personLogin: 'p1',
        personCode: 'P1',
        personGroup: 'G1',
        coderResults: [
          {
            coderId: 1,
            coderName: 'Coder',
            jobId: 11,
            jobName: 'Coding Job A',
            code: 1,
            score: 1,
            notes: null,
            codedAt: new Date()
          },
          {
            coderId: 2,
            coderName: 'Coder',
            jobId: 12,
            jobName: 'Coding Job B',
            code: 2,
            score: 0,
            notes: null,
            codedAt: new Date()
          },
          {
            coderId: 3,
            coderName: 'Coder (2)',
            jobId: 13,
            jobName: 'Coding Job C',
            code: 3,
            score: 0,
            notes: null,
            codedAt: new Date()
          }
        ]
      }
    ]);
    codingStatisticsService.calculateCohensKappa.mockReturnValue([
      {
        coder1Id: 1,
        coder1Name: 'Coder',
        coder2Id: 2,
        coder2Name: 'Coder',
        kappa: 0,
        agreement: 0,
        totalItems: 1,
        validPairs: 1,
        interpretation: 'kappa.slight'
      },
      {
        coder1Id: 1,
        coder1Name: 'Coder',
        coder2Id: 3,
        coder2Name: 'Coder (2)',
        kappa: 0,
        agreement: 0,
        totalItems: 1,
        validPairs: 1,
        interpretation: 'kappa.slight'
      },
      {
        coder1Id: 2,
        coder1Name: 'Coder',
        coder2Id: 3,
        coder2Name: 'Coder (2)',
        kappa: 0,
        agreement: 0,
        totalItems: 1,
        validPairs: 1,
        interpretation: 'kappa.slight'
      }
    ]);
    const response = {
      setHeader: jest.fn(),
      send: jest.fn()
    };

    await controller.exportCohensKappaStatisticsAsXlsx(
      5,
      'true',
      undefined,
      undefined,
      'true',
      response as never
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.send.mock.calls[0][0] as Buffer);

    const codingResultsSheet = workbook.getWorksheet('Kodierergebnisse');

    expect(codingResultsSheet?.getRow(1).getCell(6).value).toBe('Coder (1).Code');
    expect(codingResultsSheet?.getRow(1).getCell(8).value).toBe('Coder (2).Code');
    expect(codingResultsSheet?.getRow(1).getCell(10).value).toBe('Coder (2) [3].Code');
    expect(codingResultsSheet?.getRow(2).getCell(6).value).toBe(1);
    expect(codingResultsSheet?.getRow(2).getCell(8).value).toBe(2);
    expect(codingResultsSheet?.getRow(2).getCell(10).value).toBe(3);
  });
});
