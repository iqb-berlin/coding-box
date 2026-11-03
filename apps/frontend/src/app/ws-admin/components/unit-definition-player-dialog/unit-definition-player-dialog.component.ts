import { TranslateModule } from '@ngx-translate/core';
import {
  Component, OnInit, signal, ChangeDetectionStrategy, DestroyRef, inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import * as xml2js from 'xml2js';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
import { FileService } from '../../../shared/services/file/file.service';
import { FilesDto } from '../../../../../../../api-dto/files/files.dto';
import { UnitPlayerComponent } from '../../../replay/components/unit-player/unit-player.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-unit-definition-player-dialog',
  templateUrl: './unit-definition-player-dialog.component.html',
  styleUrls: ['./unit-definition-player-dialog.component.scss'],
  standalone: true,
  imports: [TranslateModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    UnitPlayerComponent
  ]
})
export class UnitDefinitionPlayerDialogComponent implements OnInit {
  private readonly uiTranslate = injectUiTranslator();

  dialogRef = inject<MatDialogRef<UnitDefinitionPlayerDialogComponent>>(MatDialogRef);
  protected data = inject<{
    workspaceId: number;
    unitId: string;
  }>(MAT_DIALOG_DATA);

  private fileService = inject(FileService);

  private readonly destroyRef = inject(DestroyRef);

  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly unitDef = signal<string | undefined>(undefined);
  protected readonly unitPlayer = signal<string | undefined>(undefined);

  ngOnInit(): void {
    if (this.data.workspaceId && this.data.unitId) {
      this.loadUnitData();
    } else {
      this.errorMessage.set(this.uiTranslate('ui-text.unit-definition-player-dialog.invalid-parameters'));
      this.isLoading.set(false);
    }
  }

  protected close(): void {
    this.dialogRef.close();
  }

  private loadUnitData(): void {
    const workspaceId = this.data.workspaceId;
    const unitId = this.data.unitId.toUpperCase();

    this.fileService.getUnit(workspaceId, unitId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (unitFiles: FilesDto[]) => {
        if (!unitFiles || unitFiles.length === 0) {
          this.errorMessage.set(this.uiTranslate('ui-text.unit-definition-player-dialog.unit-not-found', { unitId: unitId }));
          this.isLoading.set(false);
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
          this.errorMessage.set(this.uiTranslate('ui-text.unit-definition-player-dialog.player-missing'));
          this.isLoading.set(false);
          return;
        }

        const normalizedPlayerId = this.normalizePlayerId(playerRef);

        forkJoin({
          def: this.fileService.getUnitDef(workspaceId, unitId),
          player: this.fileService.getPlayer(workspaceId, normalizedPlayerId)
        }).pipe(
          catchError(() => {
            this.errorMessage.set(this.uiTranslate('ui-text.unit-definition-player-dialog.definition-load-failed'));
            this.isLoading.set(false);
            return of({ def: [] as FilesDto[], player: [] as FilesDto[] });
          })
        ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result: { def: FilesDto[]; player: FilesDto[] }) => {
          if (this.errorMessage()) {
            return;
          }

          const defFile = result.def[0];
          const playerFile = result.player[0];

          if (!defFile || !playerFile) {
            this.errorMessage.set(this.uiTranslate('ui-text.unit-definition-player-dialog.definition-or-player-load-failed'));
            this.isLoading.set(false);
            return;
          }

          this.unitDef.set(defFile.data);
          this.unitPlayer.set(playerFile.data);
          this.isLoading.set(false);
        });
      },
      error: () => {
        this.errorMessage.set(this.uiTranslate('ui-text.unit-definition-player-dialog.unit-data-load-failed'));
        this.isLoading.set(false);
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
