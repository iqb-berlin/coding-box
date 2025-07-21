import { Injectable, inject } from '@angular/core';
import {
  Observable,
  map,
  catchError,
  of,
  switchMap
} from 'rxjs';
import { BackendService } from './backend.service';

export interface BookletReplayUnit {
  id: number;
  name: string;
  alias: string | null;
  bookletId: number;
}

export interface BookletReplay {
  id: number;
  name: string;
  units: BookletReplayUnit[];
  currentUnitIndex: number;
}

@Injectable({
  providedIn: 'root'
})
export class BookletReplayService {
  private backendService = inject(BackendService);
  getBookletFromFileUpload(workspaceId: number, bookletFileId: string): Observable<BookletReplay | null> {
    return this.backendService.getUnit(workspaceId, bookletFileId).pipe(
      switchMap(bookletFiles => {
        if (!bookletFiles || bookletFiles.length === 0) {
          return of(null);
        }

        const bookletFile = bookletFiles[0];
        const bookletId = 0;
        let bookletName = bookletFileId;

        try {
          if (bookletFile.file_id) {
            bookletName = bookletFile.file_id;
          }
        } catch (error) {
          console.error('Error extracting basic booklet information:', error);
        }

        return this.backendService.getBookletUnits(workspaceId, bookletFileId).pipe(
          map(units => {
            if (!units || units.length === 0) {
              console.warn(`No units found in booklet ${bookletFileId}`);
              return null;
            }

            const bookletReplay: BookletReplay = {
              id: bookletId,
              name: bookletName,
              units: units.map(unit => ({
                id: unit.id,
                name: unit.name,
                alias: unit.alias,
                bookletId: unit.bookletId || bookletId
              })),
              currentUnitIndex: 0
            };

            return bookletReplay;
          })
        );
      }),
      catchError(() => of(null))
    );
  }
}
