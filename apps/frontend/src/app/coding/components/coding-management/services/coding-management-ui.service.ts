import { Injectable, inject } from '@angular/core';
import {
  Observable, of, switchMap, catchError
} from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppService } from '../../../../core/services/app.service';
import { FileService } from '../../../../shared/services/file/file.service';
import { CodingStatisticsService } from '../../../services/coding-statistics.service';
import { Success } from '../../../models/success.model';
import { ContentDialogComponent } from '../../../../shared/dialogs/content-dialog/content-dialog.component';

@Injectable({
  providedIn: 'root'
})
export class CodingManagementUiService {
  private appService = inject(AppService);
  private fileService = inject(FileService);
  private statisticsService = inject(CodingStatisticsService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  /**
     * Opens replay for a response by creating a token and generating replay URL
     */
  openReplayForResponse(response: Success): Observable<string> {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!response.id) {
      this.snackBar.open('Fehlende Response-ID für Replay', 'Schließen', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
      return of('');
    }

    return this.appService
      .createToken(workspaceId, this.appService.loggedUser?.sub || '', 3600)
      .pipe(
        catchError(() => {
          this.snackBar.open(
            'Fehler beim Abrufen des Tokens für Replay',
            'Schließen',
            {
              duration: 5000,
              panelClass: ['error-snackbar']
            }
          );
          return of('');
        }),
        switchMap(token => {
          if (!token) {
            return of('');
          }
          return this.statisticsService.getReplayUrl(workspaceId, response.id, token).pipe(
            switchMap(result => {
              if (!result.replayUrl) {
                this.snackBar.open(
                  'Fehler beim Generieren der Replay-URL',
                  'Schließen',
                  {
                    duration: 5000,
                    panelClass: ['error-snackbar']
                  }
                );
                return of('');
              }
              return of(result.replayUrl);
            })
          );
        })
      );
  }

  /**
     * Gets coding scheme reference from unit XML
     */
  getCodingSchemeFromUnit(unitId: number): Observable<string | null> {
    const workspaceId = this.appService.selectedWorkspaceId;

    return this.fileService.getUnitContentXml(workspaceId, unitId.toString()).pipe(
      switchMap(xmlContent => {
        if (!xmlContent) {
          this.snackBar.open(
            `Fehler beim Abrufen der Unit-XML-Daten für Unit ${unitId}`,
            'Schließen',
            {
              duration: 5000,
              panelClass: ['error-snackbar']
            }
          );
          return of(null);
        }

        const codingSchemeRef = this.extractCodingSchemeRefFromXml(xmlContent);
        if (!codingSchemeRef) {
          this.snackBar.open(
            `Kein Kodierschema in Kodierdaten für die Unit ${unitId} gefunden.`,
            'Schließen',
            {
              duration: 5000
            }
          );
          return of(null);
        }

        return of(codingSchemeRef);
      }),
      catchError(() => {
        this.snackBar.open(
          `Fehler beim Abrufen der Unit-XML-Daten für Unit ${unitId}`,
          'Schließen',
          {
            duration: 5000,
            panelClass: ['error-snackbar']
          }
        );
        return of(null);
      })
    );
  }

  /**
     * Extracts coding scheme reference from XML content
     */
  extractCodingSchemeRefFromXml(xmlContent: string): string | null {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');
      const codingSchemeRefElement = xmlDoc.querySelector('CodingSchemeRef');

      if (codingSchemeRefElement && codingSchemeRefElement.textContent) {
        return codingSchemeRefElement.textContent.trim();
      }
    } catch (error) {
      this.snackBar.open(
        'Fehler beim Verarbeiten der Unit-XML-Daten',
        'Schließen',
        {
          duration: 5000,
          panelClass: ['error-snackbar']
        }
      );
    }

    return null;
  }

  /**
     * Shows coding scheme in a dialog
     */
  showCodingSchemeDialog(codingSchemeRef: string): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    this.fileService
      .getCodingSchemeFile(workspaceId, codingSchemeRef)
      .pipe(
        catchError(() => {
          this.snackBar.open(
            `Fehler beim Abrufen des Kodierschemas '${codingSchemeRef}'`,
            'Schließen',
            {
              duration: 5000,
              panelClass: ['error-snackbar']
            }
          );
          return of(null);
        })
      )
      .subscribe(fileData => {
        if (!fileData || !fileData.base64Data) {
          this.snackBar.open(
            `Kodierschema '${codingSchemeRef}' in Kodierdaten nicht gefunden.`,
            'Schließen',
            {
              duration: 5000,
              panelClass: ['error-snackbar']
            }
          );
          return;
        }

        try {
          const decodedData = fileData.base64Data;

          this.dialog.open(ContentDialogComponent, {
            width: '80%',
            data: {
              title: `Kodierschema: ${codingSchemeRef}`,
              content: decodedData,
              isJson: true
            }
          });
        } catch (error) {
          this.snackBar.open(
            `Fehler beim Verarbeiten des Kodierschemas '${codingSchemeRef}'`,
            'Schließen',
            {
              duration: 5000,
              panelClass: ['error-snackbar']
            }
          );
        }
      });
  }

  /**
     * Shows unit XML in a dialog
     */
  showUnitXmlDialog(unitId: number): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    this.fileService
      .getUnitContentXml(workspaceId, unitId.toString())
      .pipe(
        catchError(() => {
          this.snackBar.open(
            `Fehler beim Abrufen der Unit-XML-Daten für Unit ${unitId}`,
            'Schließen',
            {
              duration: 5000,
              panelClass: ['error-snackbar']
            }
          );
          return of(null);
        })
      )
      .subscribe(xmlContent => {
        if (!xmlContent) return;
        this.dialog.open(ContentDialogComponent, {
          width: '80%',
          data: {
            title: `Unit-XML für Unit ${unitId}`,
            content: xmlContent,
            isXml: true
          }
        });
      });
  }
}
