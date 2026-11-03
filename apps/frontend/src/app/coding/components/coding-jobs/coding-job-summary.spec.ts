import { translateGerman } from '../../../../testing/german-translations';
import { CodingJob } from '../../models/coding-job.model';
import { codingJobIssueSummary, codingJobVariableSummary } from './coding-job-summary';

describe('coding job summaries', () => {
  const job: CodingJob = {
    id: 1, workspace_id: 1, name: 'Job', status: 'active', created_at: new Date(), updated_at: new Date(), assignedCoders: []
  };
  it('prefers assigned variables and falls back to loaded details', () => {
    expect(codingJobVariableSummary(job, { variables: [{ unitName: 'U', variableId: 'v' }] }, translateGerman)).toBe('U_v');
    expect(codingJobVariableSummary({ ...job, assignedVariables: [{ unitName: 'Other', variableId: 'w' }] }, { variables: [{ unitName: 'U', variableId: 'v' }] }, translateGerman)).toContain('Other_w');
    expect(codingJobVariableSummary(job, undefined, translateGerman)).toBe('Keine Variablen zugewiesen');
  });
  it('distinguishes open work without review issues from classified review issues', () => {
    const translate = jest.fn(translateGerman);
    codingJobIssueSummary({
      ...job,
      issueSummary: {
        total: 0, open: 2, codeAssignmentUncertain: 0, newCodeNeeded: 0
      }
    }, translate);
    expect(translate).toHaveBeenCalledWith('coding.jobs.issue-tooltip.open-no-review-issues-plural', { count: 2 });
    translate.mockClear();
    codingJobIssueSummary({
      ...job,
      issueSummary: {
        total: 2, open: 0, codeAssignmentUncertain: 1, newCodeNeeded: 1
      }
    }, translate);
    expect(translate).toHaveBeenCalledWith('coding.jobs.issue-tooltip.code-assignment-uncertain', { count: 1 });
    expect(translate).toHaveBeenCalledWith('coding.jobs.issue-tooltip.new-code-needed', { count: 1 });
  });
});
