import { validateSync } from 'class-validator';
import {
  canTransitionCodingJobStatus,
  CODING_JOB_STATUSES,
  isInitialCodingJobStatus
} from './coding-job-status-policy';
import { CreateCodingJobDto } from '../../../admin/coding-job/dto/create-coding-job.dto';
import { UpdateCodingJobDto } from '../../../admin/coding-job/dto/update-coding-job.dto';

describe('coding job status policy', () => {
  it.each(['pending', 'active', 'paused', 'open'])(
    'accepts initial status %s in the creation DTO', status => {
      const errors = validateSync(Object.assign(new CreateCodingJobDto(), { status }));
      expect(errors.some(error => error.property === 'status')).toBe(false);
    }
  );

  it.each(['completed', 'review', 'results_applied'])(
    'rejects initial status %s in the creation DTO', status => {
      const errors = validateSync(Object.assign(new CreateCodingJobDto(), { status }));
      expect(errors.some(error => error.property === 'status')).toBe(true);
    }
  );

  it('rejects the internal applied status in the public update DTO', () => {
    const errors = validateSync(Object.assign(new UpdateCodingJobDto(), { status: 'results_applied' }));
    expect(errors.some(error => error.property === 'status')).toBe(true);
  });

  it.each(['pending', 'active', 'paused', 'open'])(
    'allows %s as an initial status',
    status => expect(isInitialCodingJobStatus(status)).toBe(true)
  );

  it.each(['completed', 'review', 'results_applied', 'archived', '', undefined])(
    'rejects %s as an initial status',
    status => expect(isInitialCodingJobStatus(status)).toBe(false)
  );

  it.each([
    ['pending', 'active'],
    ['active', 'paused'],
    ['paused', 'active'],
    ['open', 'active'],
    ['active', 'completed'],
    ['completed', 'active'],
    ['completed', 'review'],
    ['review', 'review']
  ])('allows the workflow transition %s -> %s', (from, to) => {
    expect(canTransitionCodingJobStatus(from, to)).toBe(true);
  });

  it.each(CODING_JOB_STATUSES)(
    'protects applied results against public updates to %s',
    to => expect(canTransitionCodingJobStatus('results_applied', to)).toBe(false)
  );

  it.each(['pending', 'active', 'paused', 'open', 'completed', 'results_applied'])(
    'protects submitted review against public updates to %s',
    to => expect(canTransitionCodingJobStatus('review', to)).toBe(false)
  );

  it.each([
    ['active', 'review'],
    ['completed', 'paused'],
    ['completed', 'open'],
    ['active', 'archived'],
    ['archived', 'active'],
    ['completed', 'results_applied']
  ])('rejects the public transition %s -> %s', (from, to) => {
    expect(canTransitionCodingJobStatus(from, to)).toBe(false);
  });

  it.each(['completed', 'review', 'results_applied'])(
    'allows %s -> results_applied through the internal apply flow',
    from => expect(canTransitionCodingJobStatus(from, 'results_applied', 'apply')).toBe(true)
  );

  it.each(['pending', 'active', 'paused', 'open', 'archived'])(
    'rejects applying results from %s',
    from => expect(canTransitionCodingJobStatus(from, 'results_applied', 'apply')).toBe(false)
  );

  it.each(['review', 'results_applied', 'archived'])(
    'rejects a restart from %s',
    from => expect(canTransitionCodingJobStatus(from, 'open', 'restart')).toBe(false)
  );

  it.each(['pending', 'active', 'paused', 'open', 'completed'])(
    'permits checking open cases for a restart from %s',
    from => expect(canTransitionCodingJobStatus(from, 'open', 'restart')).toBe(true)
  );

  it('permits cleared applied results to be reapplied only through explicit invalidation', () => {
    expect(canTransitionCodingJobStatus('results_applied', 'completed')).toBe(false);
    expect(canTransitionCodingJobStatus('results_applied', 'completed', 'invalidate-results')).toBe(true);
    expect(canTransitionCodingJobStatus('review', 'completed', 'invalidate-results')).toBe(false);
    expect(canTransitionCodingJobStatus('results_applied', 'active', 'invalidate-results')).toBe(false);
  });
});
