import { Injectable, Inject } from '@angular/core';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { map, Observable, of } from 'rxjs';

const SERVER_URL = 'http://localhost:3333/api/';
@Injectable({
  providedIn: 'root'
})
export class BackendService {
  constructor(
    @Inject('SERVER_URL') private readonly serverUrl: string,
    private http: HttpClient
  ) {}

  getVeronaPlayer(): Observable<any> {
    return this.http.get(`${SERVER_URL}player`);
  }

  uploadUnits(files: FileList | null): Observable<any | number> {
    if (files) {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }

      return this.http.post<any>(`${SERVER_URL}upload/results`, formData, {
        reportProgress: true,
        observe: 'events'
      }).pipe(
        map(event => {
          if (event) {
            if (event.type === HttpEventType.UploadProgress) {
              return event.total ? Math.round(100 * (event.loaded / event.total)) : event.loaded;
            }
            if (event.type === HttpEventType.Response) {
              return event.body || {
                source: 'upload-units',
                messages: [{ objectKey: '', messageKey: 'upload-units.request-error' }]
              };
            }
            return 0;
          }
          return -1;
        })
      );
    }
    return of(-1);
  }
}
