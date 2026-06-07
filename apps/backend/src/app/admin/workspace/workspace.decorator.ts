import { createParamDecorator, ExecutionContext, BadRequestException } from '@nestjs/common';
import { parseWorkspaceId } from './workspace-id.util';

export const WorkspaceId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const params = request.params;
    const workspaceId = parseWorkspaceId(params.workspace_id);

    if (!workspaceId) {
      throw new BadRequestException('workspace_id must be a positive number');
    }

    return workspaceId;
  }
);
