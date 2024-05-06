import { Injectable, Inject } from '@angular/core';
import { HttpClient, HttpEventType } from '@angular/common/http';
import {
  catchError, map, Observable, of
} from 'rxjs';
import { CreateUserDto } from '../../../api-dto/user/create-user-dto';
import { AppService } from './app.service';
import { UserFullDto } from '../../../api-dto/user/user-full-dto';

const SERVER_URL = 'http://localhost:3333/api/';
@Injectable({
  providedIn: 'root'
})
export class BackendService {
  constructor(
    @Inject('SERVER_URL') private readonly serverUrl: string,
    private http: HttpClient, public appService: AppService
  ) {
  }

  getVeronaPlayer(): Observable<any> {
    return this.http.get(`${SERVER_URL}player`);
  }

  login(user: CreateUserDto): Observable<string> {
    return this.http.post<string>(`${SERVER_URL}login`, user);
  }

  getUsersFull(): Observable<UserFullDto[]> {
    return this.http
      .get<UserFullDto[]>(`${this.serverUrl}admin/users/full`)
      .pipe(
        catchError(() => of([]))
      );
  }

  addUser(newUser: CreateUserDto): Observable<boolean> {
    return this.http
      .post(`${this.serverUrl}admin/users`, newUser)
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  changeUserData(newData: UserFullDto): Observable<boolean> {
    return this.http
      .patch(`${this.serverUrl}admin/users`, newData)
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  deleteUsers(users: number[]): Observable<boolean> {
    return this.http
      .delete(`${this.serverUrl}admin/users/${users.join(';')}`)
      .pipe(
        catchError(() => of(false)),
        map(() => true)
      );
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
