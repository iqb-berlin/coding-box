import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { from, lastValueFrom, Observable } from 'rxjs';
import { withWorkspaceCodingStatusMutationLock } from '../../database/services/shared/workspace-coding-status-revision.util';

const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Keep this list aligned with HTTP mutations that change cached coding status.
// Long-running test-result writes also invalidate through the shared DB lock.
const CODING_STATUS_MUTATION_PATHS = [
  '/coding-job',
  '/missings-profiles',
  '/variable-bundle',
  '/coding/aggregation-settings',
  '/coding/apply-duplicate-aggregation',
  '/coding/apply-empty-responses',
  '/coding/coder-training',
  '/coding/create-distributed-jobs',
  '/coding/double-coded-review',
  '/coding/external-coding-import',
  '/coding/freshness/code',
  '/coding/job-definitions',
  '/coding/jobs',
  '/coding/reset-version'
] as const;

// These POST endpoints perform validation/calculation only. They deliberately
// share their URL prefix with the corresponding apply endpoints, so the broad
// mutation fragments above must not classify them as writes.
const CODING_STATUS_READ_ONLY_POST_PATHS = [
  /\/coding\/external-coding-import(?:\/stream)?$/,
  /\/coding\/job-definitions\/[^/]+\/(?:refresh-preview|update-refresh-preview)$/,
  /\/coding\/coder-trainings\/[^/]+\/apply-discussion-results-preview$/
] as const;

type WorkspaceRequest = {
  method?: string;
  originalUrl?: string;
  params?: { workspace_id?: string | number };
};

@Injectable()
export class CodingStatusRevisionInterceptor implements NestInterceptor {
  constructor(private readonly connection: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<WorkspaceRequest>();
    const workspaceId = Number(request.params?.workspace_id);
    if (!this.isCodingStatusMutation(request, workspaceId)) {
      return next.handle();
    }

    return from(withWorkspaceCodingStatusMutationLock(
      this.connection,
      workspaceId,
      () => lastValueFrom(next.handle())
    ));
  }

  private isCodingStatusMutation(
    request: WorkspaceRequest,
    workspaceId: number
  ): boolean {
    const method = request.method?.toUpperCase() || '';
    const path = request.originalUrl?.split('?')[0] || '';
    return (
      Number.isInteger(workspaceId) &&
      workspaceId > 0 &&
      MUTATING_HTTP_METHODS.has(method) &&
      !(
        method === 'POST' &&
        CODING_STATUS_READ_ONLY_POST_PATHS.some(pattern => pattern.test(path))
      ) &&
      CODING_STATUS_MUTATION_PATHS.some(fragment => path.includes(fragment))
    );
  }
}
