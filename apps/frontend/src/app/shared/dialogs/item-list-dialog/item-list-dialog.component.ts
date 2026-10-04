import {
  Subscription, firstValueFrom, Subject, takeUntil
} from 'rxjs';
import {
  Component, OnInit, inject, signal, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MatDialogModule, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { MetadataResolver } from '@iqb/metadata-resolver';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MetadataDialogComponent, MetadataDialogData } from '../metadata-dialog/metadata-dialog.component';
import { AppService } from '../../../core/services/app.service';
import { FileService } from '../../services/file/file.service';
import { base64ToUtf8 } from '../../utils/common-utils';
import { takeUntilWorkspaceChanged } from '../../utils/workspace-request.operator';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-item-list-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatSnackBarModule,
    MatTooltipModule,
    TranslateModule
  ],
  templateUrl: './item-list-dialog.component.html',
  styleUrls: ['./item-list-dialog.component.scss']
})
export class ItemListDialogComponent implements OnInit {
  private itemsRequest?: Subscription;

  private readonly destroyRef = inject(DestroyRef);

  private fileService = inject(FileService);
  private appService = inject(AppService);
  private dialog = inject(MatDialog);
  private dialogRef = inject(MatDialogRef<ItemListDialogComponent>);
  private snackBar = inject(MatSnackBar);
  private metadataRequestId = 0;
  private readonly metadataCancelled = new Subject<void>();
  private metadataLoadingSnackBar?: ReturnType<MatSnackBar['open']>;
  private metadataDialogRef?: MatDialogRef<MetadataDialogComponent>;

  constructor() {
    this.destroyRef.onDestroy(() => this.cancelMetadataRequest());
  }

  private cancelMetadataRequest(): void {
    this.metadataRequestId += 1;
    this.metadataCancelled.next();
    this.metadataLoadingSnackBar?.dismiss();
    const metadataDialogRef = this.metadataDialogRef;
    this.metadataDialogRef = undefined;
    metadataDialogRef?.close();
  }

  readonly itemGroups = signal<{
    fileId: string;
    id: number;
    items: string[];
  }[]>([]);

  readonly isLoading = signal(true);
  readonly error = signal('');

  ngOnInit(): void {
    this.dialogRef.beforeClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.cancelMetadataRequest());
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.cancelMetadataRequest();
      this.dialogRef.close();
    });
    this.loadItemIds();
  }

  loadItemIds(): void {
    this.itemsRequest?.unsubscribe();
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.error.set('Kein Workspace ausgewählt.');
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);
    this.error.set('');

    this.itemsRequest = this.fileService.getItemIdsFromMetadata(workspaceId).pipe(
      takeUntilWorkspaceChanged(this.appService, workspaceId),
      takeUntil(this.dialogRef.beforeClosed()),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: groups => {
        this.itemGroups.set(groups);
        this.isLoading.set(false);
      }
    });
  }

  async openMetadata(group: { fileId: string; id: number; items: string[] }, itemId?: string): Promise<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    this.cancelMetadataRequest();
    const requestId = this.metadataRequestId;
    const isCurrent = (): boolean => !this.destroyRef.destroyed && requestId === this.metadataRequestId &&
      workspaceId === this.appService.selectedWorkspaceId;
    const loadingSnackBar = this.snackBar.open('Lade Metadaten...', '', { duration: 3000 });
    this.metadataLoadingSnackBar = loadingSnackBar;

    try {
      const fileDownload = await firstValueFrom(
        this.fileService.downloadFile(workspaceId, group.id).pipe(
          takeUntil(this.metadataCancelled),
          takeUntilWorkspaceChanged(this.appService, workspaceId),
          takeUntil(this.dialogRef.beforeClosed()),
          takeUntilDestroyed(this.destroyRef)
        )
      );
      if (!isCurrent()) return;

      const decodedContent = base64ToUtf8(fileDownload.base64Data);

      const vomdData = JSON.parse(decodedContent);

      // Ensure all items have a UUID
      if (vomdData.items && Array.isArray(vomdData.items)) {
        vomdData.items.forEach((item: { id: string; uuid?: string }) => {
          if (!item.uuid) {
            item.uuid = `temp-${Math.random().toString(36).substring(2, 9)}`;
          }
        });
      }

      const unitProfile = vomdData.profiles?.[0];
      if (!unitProfile) {
        loadingSnackBar.dismiss();
        this.snackBar.open('Keine Metadaten-Profile in der Datei gefunden', 'Schließen', { duration: 5000 });
        return;
      }

      const resolver = new MetadataResolver();
      const unitProfileUrl = unitProfile.profileId;
      const unitProfileWithVocabs = await resolver.loadProfileWithVocabularies(unitProfileUrl);
      if (!isCurrent()) return;

      let itemProfileData = null;
      const firstItem = vomdData.items?.[0];
      const itemProfile = firstItem?.profiles?.[0];

      if (itemProfile) {
        const itemProfileUrl = itemProfile.profileId;
        const itemProfileWithVocabs = await resolver.loadProfileWithVocabularies(itemProfileUrl);
        if (!isCurrent()) return;
        itemProfileData = itemProfileWithVocabs.profile;
      }

      loadingSnackBar.dismiss();

      let selectedView = 'unit';
      if (itemId) {
        const foundItem = vomdData.items?.find((i: { id: string; uuid?: string }) => i.id === itemId);
        if (foundItem && foundItem.uuid) {
          selectedView = foundItem.uuid;
        }
      }

      this.metadataDialogRef = this.dialog.open(MetadataDialogComponent, {
        width: '1200px',
        maxWidth: '95vw',
        maxHeight: '95vh',
        data: {
          title: group.fileId,
          profileData: unitProfileWithVocabs.profile,
          itemProfileData: itemProfileData,
          metadataValues: vomdData,
          resolver: resolver,
          language: 'de',
          mode: 'readonly',
          selectedView: selectedView
        } as unknown as MetadataDialogData
      });
    } catch (error) {
      if (isCurrent()) this.snackBar.open('Fehler beim Öffnen der Metadaten-Datei.', 'Fehler', { duration: 3000 });
    } finally {
      loadingSnackBar.dismiss();
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
