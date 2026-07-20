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
