import { PassThrough } from 'stream';
import { CodingPsychometricExportService } from './coding-psychometric-export.service';
import { PsychometricAnalysis } from './psychometric-export.types';

describe('CodingPsychometricExportService', () => {
  const createService = () => {
    const item = {
      key: 'UNIT_A\u001FV1',
      unitName: 'UNIT_A',
      variableId: 'V1'
    };
    const mapping = {
      items: [item],
      byLogicalKey: new Map([[item.key, item]]),
      issues: [],
      fallbacks: []
    };
    const snapshot = {
      duplicatePersonIds: new Set<number>(),
      totalRows: 0,
      forEachBatch: jest.fn()
    };
    const analysis: PsychometricAnalysis = {
      rows: [],
      summary: []
    };
    const metadataResolver = {
      getDomainCandidates: jest.fn().mockResolvedValue({
        candidates: [],
        itemCount: 0,
        mappingIssueCount: 0,
        mappingFallbackCount: 0,
        mappingIssuePreview: [],
        mappingFallbackPreview: []
      }),
      buildItemMapping: jest.fn().mockResolvedValue(mapping),
      assignDomains: jest.fn(),
      loadMissingDefinitions: jest.fn().mockResolvedValue([])
    };
    const responseReader = {
      withSnapshot: jest.fn(
        async (
          _input: unknown,
          callback: (value: typeof snapshot) => Promise<unknown>
        ) => callback(snapshot)
      )
    };
    const analysisEngine = {
      analyze: jest.fn().mockResolvedValue(analysis)
    };
    const exportWriter = {
      createCsvStream: jest.fn().mockReturnValue(new PassThrough()),
      writeExcelToFile: jest.fn().mockResolvedValue(undefined)
    };
    const service = new CodingPsychometricExportService(
      metadataResolver as never,
      responseReader as never,
      analysisEngine as never,
      exportWriter as never
    );

    return {
      service,
      mapping,
      snapshot,
      analysis,
      metadataResolver,
      responseReader,
      analysisEngine,
      exportWriter
    };
  };

  it('delegates domain candidate discovery to the metadata resolver', async () => {
    const { service, metadataResolver } = createService();

    await expect(service.getDomainCandidates(7)).resolves.toEqual({
      candidates: [],
      itemCount: 0,
      mappingIssueCount: 0,
      mappingFallbackCount: 0,
      mappingIssuePreview: [],
      mappingFallbackPreview: []
    });
    expect(metadataResolver.getDomainCandidates).toHaveBeenCalledWith(7);
  });

  it('orchestrates metadata, snapshot analysis, and Excel writing', async () => {
    const {
      service,
      mapping,
      snapshot,
      analysis,
      metadataResolver,
      responseReader,
      analysisEngine,
      exportWriter
    } = createService();

    await service.writePsychometricsExcelToFile('/tmp/export.xlsx', {
      workspaceId: 7,
      version: 'v3',
      domain: { mode: 'workspace' },
      partWholeCorrection: false,
      maxCategoryCount: 12
    });

    expect(metadataResolver.buildItemMapping).toHaveBeenCalledWith(7);
    expect(metadataResolver.assignDomains).toHaveBeenCalledWith(mapping, {
      mode: 'workspace'
    });
    expect(metadataResolver.loadMissingDefinitions).toHaveBeenCalledWith(
      7,
      undefined
    );
    expect(responseReader.withSnapshot).toHaveBeenCalledWith(
      {
        workspaceId: 7,
        version: 'v3',
        mapping
      },
      expect.any(Function),
      undefined
    );
    expect(analysisEngine.analyze).toHaveBeenCalledWith({
      options: expect.objectContaining({
        workspaceId: 7,
        version: 'v3',
        partWholeCorrection: false,
        maxCategoryCount: 12
      }),
      mapping,
      missingDefinitions: [],
      snapshot
    });
    expect(exportWriter.writeExcelToFile).toHaveBeenCalledWith(
      '/tmp/export.xlsx',
      analysis,
      undefined
    );
  });

  it('passes CSV output cancellation into the analysis pipeline', async () => {
    const {
      service, analysis, analysisEngine, exportWriter
    } = createService();
    const jobCancellation = jest.fn().mockResolvedValue(undefined);
    const outputCancellation = jest.fn().mockResolvedValue(undefined);

    await service.exportPsychometricsAsCsv({
      workspaceId: 7,
      checkCancellation: jobCancellation
    });
    const analyze = exportWriter.createCsvStream.mock.calls[0][0] as (
      checkCancellation: () => Promise<void>
    ) => Promise<PsychometricAnalysis>;

    await expect(analyze(outputCancellation)).resolves.toBe(analysis);
    expect(exportWriter.createCsvStream).toHaveBeenCalledWith(
      expect.any(Function),
      jobCancellation
    );
    expect(analysisEngine.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          checkCancellation: outputCancellation
        })
      })
    );
  });
});
