import { NotFoundException } from '@nestjs/common';

export class AdminWorkspaceNotFoundException extends NotFoundException {
  constructor(workspaceId: number, method: string) {
    const description = `Admin workspace group with id ${workspaceId} not found`;
    const objectOrError = {
      id: workspaceId, controller: 'admin/workspaces', method, description
    };
    super(objectOrError);
  }
}
