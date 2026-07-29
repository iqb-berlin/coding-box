import { Module } from '@nestjs/common';
import { WorkspaceCodingStatusMutationService } from './workspace-coding-status-mutation.service';

@Module({
  providers: [WorkspaceCodingStatusMutationService],
  exports: [WorkspaceCodingStatusMutationService]
})
export class WorkspaceCodingStatusMutationModule {}
