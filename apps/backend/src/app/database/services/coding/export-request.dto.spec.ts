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
  it('requires a positive missing profile for v1', () => {
    expect(() => parseExportRequest({
      exportType: 'results-by-version',
      version: 'v1',
      format: 'csv'
    })).toThrow('results-by-version v1 exports require missingsProfileId');
  });

  it('accepts v1 with a positive missing profile', () => {
    expect(parseExportRequest({
      exportType: 'results-by-version',
      version: 'v1',
      format: 'excel',
      missingsProfileId: 7
    })).toMatchObject({ version: 'v1', missingsProfileId: 7 });
  });

  it('keeps v2 independent from missing profiles', () => {
    expect(parseExportRequest({
      exportType: 'results-by-version',
      version: 'v2',
      format: 'csv'
    })).toMatchObject({ version: 'v2' });
  });
});
