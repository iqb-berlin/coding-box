import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { InvalidResponsePage, InvalidResponseValidationService } from './invalid-response-validation.service';

@Injectable({ providedIn: 'root' })
export class VariableTypeValidationService extends InvalidResponseValidationService {
  protected readonly validationType = 'variableTypes';

  protected loadPage(workspaceId: number, page: number, limit: number): Observable<InvalidResponsePage> {
    return this.validationService.validateVariableTypes(workspaceId, page, limit);
  }
}
