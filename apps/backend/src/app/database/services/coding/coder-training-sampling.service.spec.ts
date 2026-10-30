import { CoderTrainingSamplingService } from './coder-training-sampling.service';
import { CoderTrainingResponse, TrainingBundleConfig } from './coder-training.types';

describe('CoderTrainingSamplingService', () => {
  const service = new CoderTrainingSamplingService();
  const response = (responseId: number, overrides: Partial<CoderTrainingResponse> = {}): CoderTrainingResponse => ({
    responseId,
    unitAlias: 'U',
    unitName: 'U',
    variableId: 'v',
    variable: 'v',
    value: null,
    personLogin: `person-${responseId}`,
    personCode: 'code',
    personGroup: 'A',
    bookletName: 'booklet',
    ...overrides
  });

  afterEach(() => jest.restoreAllMocks());

  it('orders samples by chunk timestamp, falling back to response ID and breaking ties by ID', () => {
    const responses = [response(3, { chunkTs: 1 }), response(2, { chunkTs: 1 }), response(4), response(1, { chunkTs: 9 })];
    expect(service.sampleResponses(responses, 2, 'oldest_first').map(r => r.responseId)).toEqual([2, 3]);
    expect(service.sampleResponses(responses, 2, 'newest_first').map(r => r.responseId)).toEqual([1, 4]);
    expect(responses.map(r => r.responseId)).toEqual([3, 2, 4, 1]);
  });

  it('balances random-per-group sampling until smaller groups are exhausted', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.999);
    const responses = [response(1), response(2), response(3), response(4, { personGroup: 'B' }), response(5, { personGroup: '' })];
    expect(service.sampleResponses(responses, 4, 'random_per_testgroup').map(r => r.responseId)).toEqual([1, 4, 5, 2]);
    expect(responses).toHaveLength(5);
  });

  it('keeps all selected variables of a bundle in the same person/booklet case', () => {
    const first = response(1, { personLogin: 'first', chunkTs: 1 });
    const second = response(2, { personLogin: 'second', chunkTs: 2 });
    const firstOther = response(3, { personLogin: 'first', variableId: 'w', chunkTs: 3 });
    const secondOther = response(4, { personLogin: 'second', variableId: 'w', chunkTs: 4 });
    const bundle: TrainingBundleConfig = {
      id: 9,
      name: 'bundle',
      sampleCount: 1,
      variables: [{ unitId: 'U', variableId: 'v', sampleCount: 1 }, { unitId: 'U', variableId: 'w', sampleCount: 1 }]
    };
    const selected = service.sampleBundleResponses(bundle, new Map([['U:v', [first, second]], ['U:w', [firstOther, secondOther]]]), 'oldest_first');
    expect(selected.get('U:v')).toEqual([first]);
    expect(selected.get('U:w')).toEqual([firstOther]);
  });

  it('applies same/different references independently for each variable', () => {
    const responses = [response(1), response(2)];
    expect(service.applyReferenceFilter(responses, 'same', { 'U:v': [2] }, 'U:v')).toEqual([responses[1]]);
    expect(service.applyReferenceFilter(responses, 'different', { 'U:v': [2] }, 'U:v')).toEqual([responses[0]]);
    expect(service.applyReferenceFilter(responses, 'same', {}, 'U:v')).toEqual([]);
    expect(service.applyReferenceFilter(responses, 'different', {}, 'U:v')).toEqual(responses);
  });

  it('sorts continuous cases by variable and alternating cases by person without changing the source', () => {
    const responses = [response(1, { personLogin: 'b', variableId: 'a' }), response(2, { personLogin: 'a', variableId: 'b' })];
    expect(service.sortTrainingResponses(responses, 'continuous').map(r => r.responseId)).toEqual([1, 2]);
    expect(service.sortTrainingResponses(responses, 'alternating').map(r => r.responseId)).toEqual([2, 1]);
    expect(responses.map(r => r.responseId)).toEqual([1, 2]);
  });
});
