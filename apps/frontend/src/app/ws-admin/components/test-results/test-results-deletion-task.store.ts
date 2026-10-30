import { Injectable } from '@angular/core';
import { ValidationTaskDto } from '../../../models/validation-task.dto';
import { TestResultsDeleteCommand } from './test-results.models';

interface KnownDeletion {
  task: ValidationTaskDto;
  command?: TestResultsDeleteCommand;
}

// Keep accepted jobs across feature destruction without keeping views or subscriptions alive.
@Injectable({ providedIn: 'root' })
export class TestResultsDeletionTaskStore {
  private readonly jobs = new Map<number, KnownDeletion>();

  get(workspaceId: number): KnownDeletion | undefined {
    return this.jobs.get(workspaceId);
  }

  remember(workspaceId: number, task: ValidationTaskDto, command?: TestResultsDeleteCommand): void {
    if (task.status === 'pending' || task.status === 'processing') {
      this.jobs.set(workspaceId, { task: { ...task }, command });
    } else if (this.jobs.get(workspaceId)?.task.id === task.id) {
      this.jobs.delete(workspaceId);
    }
  }
}
