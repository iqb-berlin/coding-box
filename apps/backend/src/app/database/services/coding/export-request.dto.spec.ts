import {
  ExportRequestValidationError,
  parseExportRequest
} from '../../../../../../../api-dto/coding/export-request.dto';

describe('item dataset export request validation', () => {
  it('accepts the full item dataset request without changing the technical type', () => {
    expect(parseExportRequest({
      exportType: 'item-matrix',
      missingsProfileId: 4,
      notReachedScope: 'testlet',
      recodeTrailingOmissions: true,
      items: [{ unitId: 'UNIT1', itemId: 'ITEM1' }]
    })).toMatchObject({
      exportType: 'item-matrix',
      missingsProfileId: 4
    });
  });

  it('requires an explicit missing profile', () => {
    expect(() => parseExportRequest({
      exportType: 'item-matrix'
    })).toThrow(ExportRequestValidationError);
  });

  it('allows trailing omission recoding only for testlet or booklet scope', () => {
    expect(() => parseExportRequest({
      exportType: 'item-matrix',
      missingsProfileId: 4,
      notReachedScope: 'unit',
      recodeTrailingOmissions: true
    })).toThrow(
      'item-matrix recodeTrailingOmissions is supported only for testlet or booklet scope'
    );
  });
});

describe('results-by-version export request validation', () => {
  it.each(['v1', 'v2', 'v3'] as const)(
    'requires a positive missing profile for %s',
    version => {
      expect(() => parseExportRequest({
        exportType: 'results-by-version',
        version,
        format: 'csv'
      })).toThrow('results-by-version exports require missingsProfileId');
    }
  );

  it('accepts v1 with a positive missing profile', () => {
    expect(parseExportRequest({
      exportType: 'results-by-version',
      version: 'v1',
      format: 'excel',
      missingsProfileId: 7
    })).toMatchObject({ version: 'v1', missingsProfileId: 7 });
  });

  it('accepts v2 with a positive missing profile', () => {
    expect(parseExportRequest({
      exportType: 'results-by-version',
      version: 'v2',
      format: 'csv',
      missingsProfileId: 7
    })).toMatchObject({ version: 'v2', missingsProfileId: 7 });
  });
});
