import { translateGerman } from '../../../../testing/german-translations';
import { blockingDefinitionJobCount, createdDefinitionJobCount, definitionWorkflowLabel } from './job-definition-workflow';

describe('job definition workflow', () => {
  it('distinguishes unknown counts from an explicit zero and normalizes negatives', () => {
    expect(createdDefinitionJobCount({})).toBeUndefined();
    expect(createdDefinitionJobCount({ createdJobsCount: NaN })).toBeUndefined();
    expect(blockingDefinitionJobCount({ blockingCreatedJobsCount: Infinity })).toBeUndefined();
    expect(createdDefinitionJobCount({ createdJobsCount: -2 })).toBe(0);
    expect(blockingDefinitionJobCount({ blockingCreatedJobsCount: 0 })).toBe(0);
  });
  it('communicates unknown, empty and created workflows separately', () => {
    const translate = jest.fn(translateGerman);
    definitionWorkflowLabel({ id: 1 }, translate);
    expect(translate).toHaveBeenLastCalledWith('coding-job-definitions.workflow.jobs-count-unavailable', expect.any(Object));
    definitionWorkflowLabel({ id: 1, createdJobsCount: 0 }, translate);
    expect(translate).toHaveBeenLastCalledWith('coding-job-definitions.workflow.no-jobs', expect.any(Object));
    definitionWorkflowLabel({ id: 1, createdJobsCount: 2 }, translate);
    expect(translate).toHaveBeenLastCalledWith('coding-job-definitions.workflow.many-jobs', expect.objectContaining({ count: 2 }));
  });
});
