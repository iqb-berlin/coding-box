import type { CodingJob } from '../../models/coding-job.model';
import type { ManualCodingFreshnessJobSummary as ManualFreshnessJobSummary } from '../../services/manual-coding-planning-snapshot.model';

interface SavedCodeProgress { id?: number; codingIssueOption?: number; [key: string]: unknown; }

export function buildManualFreshnessJobSummary(jobs: CodingJob[]): ManualFreshnessJobSummary {
  return jobs.reduce<ManualFreshnessJobSummary>(
    (summary, job) => {
      if (job.freshnessStatus === 'stale_source') {
        summary.staleSourceJobs += 1;
      }

      if (isTrainingCodingJob(job)) {
        if (isActiveCodingJob(job)) {
          summary.activeTrainingJobs += 1;
        }
        return summary;
      }

      if (isActiveCodingJob(job)) {
        summary.openProductiveJobs += 1;
        return summary;
      }

      if (isCompletedManualCodingJob(job) &&
            job.freshnessStatus !== 'stale_source') {
        summary.completedProductiveJobs += 1;
      }

      return summary;
    },
    {
      activeTrainingJobs: 0,
      openProductiveJobs: 0,
      completedProductiveJobs: 0,
      staleSourceJobs: 0
    }
  );
}

export function isTrainingCodingJob(job: CodingJob): boolean {
  return !!job.training?.id || !!job.training_id;
}

export function isActiveCodingJob(job: CodingJob): boolean {
  if (['completed', 'review', 'results_applied'].includes(job.status)) {
    return false;
  }

  return job.status === 'open' ||
      (job.openUnits ?? 0) > 0 ||
      (job.totalUnits ?? 0) > 0;
}

export function isCompletedManualCodingJob(job: CodingJob): boolean {
  if (job.status === 'results_applied') {
    return false;
  }

  if (['completed', 'review'].includes(job.status)) {
    return true;
  }

  const totalUnits = job.totalUnits ?? 0;
  return totalUnits > 0 &&
      (job.openUnits ?? 0) === 0 &&
      (job.codedUnits ?? 0) >= totalUnits;
}

export function hasBlockingCodingIssues(progress?: Record<string, unknown>): boolean {
  if (!progress) {
    return false;
  }

  return Object.values(progress).some(value => {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const savedCode = value as SavedCodeProgress;
    return savedCode.id === -1 ||
        savedCode.id === -2 ||
        savedCode.codingIssueOption === -1 ||
        savedCode.codingIssueOption === -2;
  });
}

export function hasCodingIssuesForCompletedJob(
  job: CodingJob,
  progress?: Record<string, unknown>
): boolean {
  if (progress === undefined) {
    return job.hasIssues === true;
  }

  return hasBlockingCodingIssues(progress);
}

export function isCodingJobReadyForApply(job: CodingJob): boolean {
  return ['completed', 'review'].includes(job.status) &&
      job.freshnessStatus !== 'stale_source' &&
      !job.training?.id &&
      !job.training_id;
}
