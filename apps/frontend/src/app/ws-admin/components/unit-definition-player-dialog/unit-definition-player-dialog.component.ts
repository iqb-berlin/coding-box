import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import * as xml2js from 'xml2js';
import { BackendService } from '../../../services/backend.service';
import { FilesDto } from '../../../../../../../api-dto/files/files.dto';
import { UnitPlayerComponent } from '../../../replay/components/unit-player/unit-player.component';

@Component({
  selector: 'coding-box-unit-definition-player-dialog',
  templateUrl: './unit-definition-player-dialog.component.html',
  styleUrls: ['./unit-definition-player-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    UnitPlayerComponent
  ]
})
export class UnitDefinitionPlayerDialogComponent implements OnInit {
  isLoading = true;
  errorMessage: string | null = null;

  unitDef: string | undefined;
  unitPlayer: string | undefined;

  constructor(
    public dialogRef: MatDialogRef<UnitDefinitionPlayerDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { workspaceId: number; unitId: string },
    private backendService: BackendService
  ) {}

  ngOnInit(): void {
    if (this.data.workspaceId && this.data.unitId) {
      this.loadUnitData();
    } else {
      this.errorMessage = 'Ungültige Parameter für die Aufgabendefinition.';
      this.isLoading = false;
    }
  }

  close(): void {
    this.dialogRef.close();
  }

  private loadUnitData(): void {
    const workspaceId = this.data.workspaceId;
    const unitId = this.data.unitId.toUpperCase();

    this.backendService.getUnit(workspaceId, unitId).subscribe({
      next: unitFiles => {
        if (!unitFiles || unitFiles.length === 0) {
          this.errorMessage = `Aufgabe ${unitId} wurde nicht gefunden.`;
          this.isLoading = false;
          return;
        }

        const unitFile = unitFiles[0];
        const unitXml = unitFile.data;

        let playerRef = '';
        try {
          xml2js.parseString(unitXml, (err: unknown, result: unknown) => {
            const parsed = result as { Unit?: { DefinitionRef?: Array<{ $?: { player?: string } }> } };
            if (!err && parsed?.Unit?.DefinitionRef?.[0]?.$?.player) {
              playerRef = parsed.Unit.DefinitionRef[0].$.player as string;
            }
          });
        } catch {
          // ignore, handled below
        }

        if (!playerRef) {
          this.errorMessage = 'Kein Player in der Aufgabendefinition gefunden.';
          this.isLoading = false;
          return;
        }

        const normalizedPlayerId = this.normalizePlayerId(playerRef);

        forkJoin({
          def: this.backendService.getUnitDef(workspaceId, unitId),
          player: this.backendService.getPlayer(workspaceId, normalizedPlayerId)
        }).pipe(
          catchError(() => {
            this.errorMessage = 'Fehler beim Laden der Aufgabendefinition.';
            this.isLoading = false;
            return of({ def: [] as FilesDto[], player: [] as FilesDto[] });
          })
        ).subscribe(result => {
          if (this.errorMessage) {
            return;
          }

          const defFile = result.def[0];
          const playerFile = result.player[0];

          if (!defFile || !playerFile) {
            this.errorMessage = 'Aufgabendefinition oder Player konnten nicht geladen werden.';
            this.isLoading = false;
            return;
          }

          this.unitDef = defFile.data;
          this.unitPlayer = playerFile.data;
          this.isLoading = false;
        });
      },
      error: () => {
        this.errorMessage = 'Fehler beim Laden der Aufgabendaten.';
        this.isLoading = false;
      }
    });
  }

  private normalizePlayerId(name: string): string {
    const reg = /^(\D+?)[@V-]?((\d+)(\.\d+)?(\.\d+)?(-\S+?)?)?(\.\D{3,4})?$/;
    const matches = name.match(reg);

    if (matches) {
      const rawIdParts = {
        module: matches[1] || '',
        major: parseInt(matches[3] || '0', 10) || 0,
        minor: matches[4] ? parseInt(matches[4].substring(1), 10) : 0,
        patch: matches[5] ? parseInt(matches[5].substring(1), 10) : 0
      };

      return `${rawIdParts.module}-${rawIdParts.major}.${rawIdParts.minor}.${rawIdParts.patch}`.toUpperCase();
    }

    // Fallback: return original name uppercased
    return name.toUpperCase();
  }
}
