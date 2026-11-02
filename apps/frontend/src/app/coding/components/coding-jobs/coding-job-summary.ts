import { CodingJob } from '../../models/coding-job.model';
import { UiTranslator } from '../../../shared/utils/ui-translator';

export function codingJobVariableSummary(job: CodingJob, cachedDetails: Pick<Partial<CodingJob>, 'variables' | 'variableBundles'> | undefined, translate: UiTranslator): string {
  if (job.assignedVariables && job.assignedVariables.length > 0) {
    const variableNames = job.assignedVariables.map(v => {
      const unitName = v.unitName || translate('ws-admin.unknown');
      const variableId = v.variableId || translate('ws-admin.unknown');
      return `${unitName}_${variableId}`;
    });
    return translate('ui-text.coding-jobs.variablen', { length: job.assignedVariables.length, value2: variableNames.join(', ') });
  }
  if (job.variables && job.variables.length > 0) {
    return job.variables
      .map(v => {
        const unitName = v.unitName || translate('ws-admin.unknown');
        const variableId = v.variableId || translate('ws-admin.unknown');
        return `${unitName}_${variableId}`;
      })
      .join(', ');
  }
  if (
    cachedDetails &&
      cachedDetails.variables &&
      cachedDetails.variables.length > 0
  ) {
    return cachedDetails.variables
      .map(v => {
        const unitName = v.unitName || translate('ws-admin.unknown');
        const variableId = v.variableId || translate('ws-admin.unknown');
        return `${unitName}_${variableId}`;
      })
      .join(', ');
  }

  return translate('ui-text.coding-jobs.keine-variablen-zugewiesen');
}

export function codingJobIssueSummary(job: CodingJob, translate: UiTranslator): string {
  const summary = job.issueSummary;
  if (!summary || summary.total === 0) {
    if (summary?.open) {
      const key =
        summary.open === 1 ?
          'coding.jobs.issue-tooltip.open-no-review-issues-singular' :
          'coding.jobs.issue-tooltip.open-no-review-issues-plural';
      return translate(key, { count: summary.open });
    }
    return translate(
      'coding.jobs.issue-tooltip.no-review-issues'
    );
  }

  const parts: string[] = [];
  if (summary.codeAssignmentUncertain > 0) {
    parts.push(
      translate(
        'coding.jobs.issue-tooltip.code-assignment-uncertain',
        { count: summary.codeAssignmentUncertain }
      )
    );
  }
  if (summary.newCodeNeeded > 0) {
    parts.push(
      translate(
        'coding.jobs.issue-tooltip.new-code-needed',
        { count: summary.newCodeNeeded }
      )
    );
  }

  return parts.join(', ');
}
