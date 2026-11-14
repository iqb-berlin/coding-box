import { ConflictException } from '@nestjs/common';

export class CodingJobWorkspaceBusyException extends ConflictException {
  constructor() {
    super({
      code: 'CODING_JOB_WORKSPACE_BUSY',
      message: 'Test results in this workspace are being updated. Try creating the coding job again once the update is complete.'
    });
  }
}
