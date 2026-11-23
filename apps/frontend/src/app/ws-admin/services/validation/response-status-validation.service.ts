import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { InvalidResponsePage, InvalidResponseValidationService } from './invalid-response-validation.service';

@Injectable({ providedIn: 'root' })
export class ResponseStatusValidationService extends InvalidResponseValidationService {
  protected readonly validationType = 'responseStatus';

  protected loadPage(workspaceId: number, page: number, limit: number): Observable<InvalidResponsePage> {
    return this.validationService.validateResponseStatus(workspaceId, page, limit);
  }
}
