import { createParamDecorator, ExecutionContext, BadRequestException } from '@nestjs/common';

export const WorkspaceId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const params = request.params;
    const workspaceId = parseInt(params.workspace_id, 10);

    if (Number.isNaN(workspaceId) || workspaceId <= 0) {
      throw new BadRequestException('workspace_id must be a positive number');
    }

    return workspaceId;
  }
);
