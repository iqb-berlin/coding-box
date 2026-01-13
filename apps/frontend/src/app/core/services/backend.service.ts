import { Injectable, inject } from '@angular/core';
import { SERVER_URL } from '../../injection-tokens';

/**
 * @deprecated Use specific services instead (CodingService, ResponseService, etc.)
 */
@Injectable({
  providedIn: 'root'
})
export class BackendService {
  readonly serverUrl = inject(SERVER_URL);
}
