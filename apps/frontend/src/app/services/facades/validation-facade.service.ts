import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ValidationService } from '../validation.service';
import { ValidationTaskDto } from '../../models/validation-task.dto';

@Injectable({
  providedIn: 'root'
})
export class ValidationFacadeService {
  private validationService = inject(ValidationService);

  createDeleteAllResponsesTask(workspaceId: number, validationType: 'variables' | 'variableTypes' | 'responseStatus' | 'duplicateResponses'): Observable<ValidationTaskDto> {
    return this.validationService.createDeleteAllResponsesTask(workspaceId, validationType);
  }

  createDeleteResponsesTask(workspaceId: number, responseIds: number[]): Observable<ValidationTaskDto> {
    return this.validationService.createDeleteResponsesTask(workspaceId, responseIds);
  }

  createValidationTask(workspaceId: number, type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'deleteResponses' | 'deleteAllResponses' | 'duplicateResponses', page?: number, limit?: number, additionalData?: Record<string, unknown>): Observable<ValidationTaskDto> {
    return this.validationService.createValidationTask(workspaceId, type, page, limit, additionalData);
  }

  getValidationTask(workspaceId: number, taskId: number): Observable<ValidationTaskDto> {
    return this.validationService.getValidationTask(workspaceId, taskId);
  }

  getValidationResults(workspaceId: number, taskId: number): Observable<unknown> {
    return this.validationService.getValidationResults(workspaceId, taskId);
  }

  pollValidationTask(workspaceId: number, taskId: number, pollInterval: number = 2000): Observable<ValidationTaskDto> {
    return this.validationService.pollValidationTask(workspaceId, taskId, pollInterval);
  }
}
