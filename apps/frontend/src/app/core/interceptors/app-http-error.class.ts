import { HttpErrorResponse } from '@angular/common/http';

export class AppHttpError {
  status: number;
  message: string;
  method = '';
  urlWithParams = '';
  id = 0;

  constructor(errorObj: HttpErrorResponse) {
    this.status = errorObj.error instanceof ErrorEvent ? 999 : errorObj.status;
    if (errorObj.status === 0) {
      this.message = 'Backend nicht erreichbar. Bitte Verbindung prüfen und die Aktion erneut versuchen.';
      return;
    }
    this.message = errorObj.error instanceof ErrorEvent ? (<ErrorEvent>errorObj.error).message : errorObj.message;
  }
}
