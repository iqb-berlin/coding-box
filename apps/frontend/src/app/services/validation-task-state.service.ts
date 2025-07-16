import { Injectable } from '@angular/core';

// Define interfaces for validation results
export interface ValidationResult {
  status: 'success' | 'failed' | 'not-run';
  timestamp: number;
  details?: unknown;
}

@Injectable({
  providedIn: 'root'
})
export class ValidationTaskStateService {
  // Store task IDs by workspace ID and validation type
  private activeTasks: Record<number, Record<string, number>> = {};

  // Store validation results by workspace ID and validation type
  private validationResults: Record<number, Record<string, ValidationResult>> = {};

  setTaskId(workspaceId: number, type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses', taskId: number): void {
    if (!this.activeTasks[workspaceId]) {
      this.activeTasks[workspaceId] = {};
    }
    this.activeTasks[workspaceId][type] = taskId;
  }

  removeTaskId(workspaceId: number, type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses'): void {
    if (this.activeTasks[workspaceId]) {
      delete this.activeTasks[workspaceId][type];
    }
  }

  getAllTaskIds(workspaceId: number): Record<string, number> {
    return this.activeTasks[workspaceId] || {};
  }

  setValidationResult(
    workspaceId: number,
    type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses',
    result: ValidationResult
  ): void {
    if (!this.validationResults[workspaceId]) {
      this.validationResults[workspaceId] = {};
    }
    this.validationResults[workspaceId][type] = result;
  }

  getAllValidationResults(workspaceId: number): Record<string, ValidationResult> {
    return this.validationResults[workspaceId] || {};
  }
}
