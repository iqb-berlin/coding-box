import Ajv from 'ajv';
import { requestBodySchemas } from '../../../../../api-dto/request-contracts';
import { toOpenApiSchema } from './validated-body.decorator';

describe('Generated OpenAPI request contracts', () => {
  const ajv = new Ajv({ strict: false });

  it.each([
    ['WorkspaceFullDto', { id: 7 }, true],
    ['WorkspaceFullDto', { name: 'Missing ID' }, false],
    ['WorkspaceFullDto', { id: 0 }, false],
    ['WorkspaceCoderTrainingController_saveDiscussionResult', {
      responseId: 1, code: null, score: null, notes: null
    }, true],
    ['WorkspaceCoderTrainingController_saveDiscussionResult', { responseId: 1, code: '1', score: null }, false],
    ['TrainingDiscussionApplyPreviewRequest', { source: 'auto_agreement' }, true],
    ['TrainingDiscussionApplyPreviewRequest', { source: 'unknown' }, false],
    ['BackgroundExportRequest', { exportType: 'item-matrix', missingsProfileId: 1, items: [{ unitId: 'U1', itemId: 'V1' }] }, true],
    ['BackgroundExportRequest', { exportType: 'item-matrix', missingsProfileId: 1, items: [{ unitId: 'U1', itemId: 1 }] }, false],
    ['ResolveDuplicateResponsesRequest', { resolutionMap: { group: 12 } }, true],
    ['ResolveDuplicateResponsesRequest', { resolutionMap: { group: '12' } }, false]
  ] as const)('preserves runtime acceptance in documentation for %s: %j', (name, payload, accepted) => {
    const contract = requestBodySchemas[name];
    expect(ajv.compile(contract)(payload)).toBe(accepted);
    expect(ajv.compile(toOpenApiSchema(contract))(payload)).toBe(accepted);
  });
});
