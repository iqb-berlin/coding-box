import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import {
  Observable,
  concatMap,
  from,
  map
} from 'rxjs';
import { touchWorkspaceCodingStatusRevision } from '../../database/services/shared/workspace-coding-status-revision.util';
import { CODING_STATUS_MUTATION_METADATA } from './coding-status-mutation.decorator';

type WorkspaceRequest = {
  params?: { workspace_id?: string | number };
};

@Injectable()
export class CodingStatusMutationInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly connection: DataSource
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const mutatesCodingStatus = this.reflector.getAllAndOverride<boolean>(
      CODING_STATUS_MUTATION_METADATA,
      [context.getHandler(), context.getClass()]
    );
    if (!mutatesCodingStatus) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<WorkspaceRequest>();
    const workspaceId = Number(request.params?.workspace_id);
    if (!Number.isInteger(workspaceId) || workspaceId < 1) {
      return next.handle();
    }

    return next.handle().pipe(
      concatMap(result => from(touchWorkspaceCodingStatusRevision(
        this.connection,
        workspaceId
      )).pipe(map(() => result)))
    );
  }
}
