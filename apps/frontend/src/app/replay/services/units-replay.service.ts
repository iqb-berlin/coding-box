import { Injectable, inject } from '@angular/core';
import {
  Observable,
  map,
  catchError,
  of,
  switchMap
} from 'rxjs';
import { FileService } from '../../shared/services/file/file.service';

export interface UnitsReplayUnit {
  id: number;
  name: string;
  alias: string | null;
  bookletId: number;
  testPerson?: string;
  variableId?: string;
  variableAnchor?: string;
}

export interface UnitsReplay {
  id: number;
  name: string;
  units: UnitsReplayUnit[];
  currentUnitIndex: number;
}

@Injectable({
  providedIn: 'root'
})
export class UnitsReplayService {
  private fileService = inject(FileService);
  getUnitsFromFileUpload(workspaceId: number, bookletFileId: string): Observable<UnitsReplay | null> {
    return this.fileService.getUnit(workspaceId, bookletFileId).pipe(
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
          // Error occurred while extracting basic booklet information
        }

        return this.fileService.getBookletUnits(workspaceId, bookletFileId).pipe(
          map(units => {
            if (!units || units.length === 0) {
              // No units found in the specified booklet
              return null;
            }

            const unitsReplay: UnitsReplay = {
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

            return unitsReplay;
          })
        );
      }),
      catchError(() => of(null))
    );
  }
}
