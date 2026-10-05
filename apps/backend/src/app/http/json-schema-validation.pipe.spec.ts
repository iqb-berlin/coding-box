import { BadRequestException } from '@nestjs/common';
import { JsonSchemaValidationPipe } from './json-schema-validation.pipe';
import { requestBodySchemas } from './request-body.schemas';

describe('JSON request contracts', () => {
  it.each([
    ['WorkspaceCodingVersionController_resetCodingVersion', { version: 'v4' }],
    ['WorkspaceCoderTrainingController_saveDiscussionResult', { responseId: 1, code: '1', score: 0 }],
    ['WorkspaceCodingStatisticsController_calculateDistribution', {
      selectedVariables: [{ unitName: 'U1', variableId: 12 }], selectedCoders: []
    }],
    ['ResolveDuplicateResponsesRequest', { resolutionMap: { group: '12' } }],
    ['ExternalCodingImportDto', { file: 'base64', sourceVersion: 'v4' }],
    ['ExternalCodingImportDto', { file: 'base64', scoreMode: 'unrecognized' }],
    ['UpdateLegalNoticeDto', { html: { arbitrary: 'object' } }],
    ['WorkspaceSettingsBatchDto', { settings: [{ key: 'key', value: false }] }],
    ['TrainingDiscussionApplySource', 'unrecognized'],
    ['ChunkedUploadInitRequestDto', { fileName: 'results.csv', fileSize: '12', mimeType: 'text/csv' }],
    ['TestResultsDeleteRequestDto', { scope: 'everything' }]
  ])('rejects malformed values for %s', (name, payload) => {
    const pipe = new JsonSchemaValidationPipe(requestBodySchemas[name]);
    expect(() => pipe.transform(payload)).toThrow(BadRequestException);
  });

  it.each([
    { exportType: 'results-by-version', missingsProfileId: 1, includeGeoGebraFiles: 'false' },
    { exportType: 'item-matrix', missingsProfileId: 1, items: [{ unitId: 'U1', itemId: 12 }] },
    {
      exportType: 'psychometrics',
      domain: {
        mode: 'vomd-field', scope: 'wrong', profileId: 'p', entryId: 'e'
      }
    },
    { exportType: 'test-results', testResultFilters: { personIds: ['12'] } },
    { exportType: 'by-coder', anonymizeCoders: 'false' }
  ])('validates discriminated export payloads: %j', payload => {
    const pipe = new JsonSchemaValidationPipe(requestBodySchemas.BackgroundExportRequest);
    expect(() => pipe.transform(payload)).toThrow(BadRequestException);
  });

  it.each([
    { exportType: 'results-by-version', missingsProfileId: 1, includeGeoGebraFiles: false },
    { exportType: 'item-matrix', missingsProfileId: 1, items: [{ unitId: 'U1', itemId: 'V1' }] },
    { exportType: 'psychometrics', domain: { mode: 'workspace' } },
    { exportType: 'test-results', testResultFilters: { personIds: [12] } }
  ])('accepts supported export variants: %j', payload => {
    const pipe = new JsonSchemaValidationPipe(requestBodySchemas.BackgroundExportRequest);
    expect(pipe.transform(payload)).toBe(payload);
  });

  it.each([null, [], 'payload', 12, true, undefined].map(value => [value]))('rejects non-object settings bodies: %j', payload => {
    const pipe = new JsonSchemaValidationPipe(requestBodySchemas.WorkspaceSettingWriteDto);
    expect(() => pipe.transform(payload)).toThrow(BadRequestException);
  });

  it('accepts nullable manual discussion results without changing them', () => {
    const pipe = new JsonSchemaValidationPipe(requestBodySchemas.WorkspaceCoderTrainingController_saveDiscussionResult);
    const payload = {
      responseId: 12, code: null, score: null, notes: null
    };
    expect(pipe.transform(payload)).toBe(payload);
  });

  it('retains free-form validation-task metadata', () => {
    const pipe = new JsonSchemaValidationPipe(requestBodySchemas.CreateValidationTaskRequestDto);
    const payload = {
      additionalData: {
        unit: 'U1', enabled: false, counts: [1, 2], nested: { any: null }
      }
    };
    expect(pipe.transform(payload)).toBe(payload);
  });

  it('allows partial user/workspace updates and logo settings without response-only fields', () => {
    const requests = [
      [requestBodySchemas.UserFullDto, { username: 'user' }],
      [requestBodySchemas.WorkspaceFullDto, { name: 'Workspace' }],
      [requestBodySchemas.AppLogoDto, { bodyBackground: '#ffffff' }]
    ] as const;
    requests.forEach(([schema, payload]) => {
      expect(new JsonSchemaValidationPipe(schema).transform(payload)).toBe(payload);
    });
  });

  it('allows absent optional fields but does not coerce string booleans', () => {
    const pipe = new JsonSchemaValidationPipe(requestBodySchemas.boolean, true);
    expect(pipe.transform(undefined)).toBeUndefined();
    expect(pipe.transform(false)).toBe(false);
    expect(() => pipe.transform('false')).toThrow(BadRequestException);
    expect(() => pipe.transform(null)).toThrow(BadRequestException);
  });

  it('does not include rejected input values in validation errors', () => {
    const pipe = new JsonSchemaValidationPipe(requestBodySchemas.WorkspaceSettingWriteDto);
    try {
      pipe.transform({ key: 'secret', value: { token: 'private-value' } });
      throw new Error('Expected validation to reject the payload');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify(error.getResponse())).not.toContain('private-value');
    }
  });
});
