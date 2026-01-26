import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { MetadataResolver } from '@iqb/metadata-resolver';
import { firstValueFrom } from 'rxjs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MetadataDialogComponent, MetadataDialogData } from '../metadata-dialog/metadata-dialog.component';
import { AppService } from '../../../core/services/app.service';
import { FileService } from '../../services/file/file.service';

@Component({
  selector: 'app-item-list-dialog',
  standalone: true,
  imports: [
    CommonModule,
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
  private fileService = inject(FileService);
  private appService = inject(AppService);
  private dialog = inject(MatDialog);
  private dialogRef = inject(MatDialogRef<ItemListDialogComponent>);
  private snackBar = inject(MatSnackBar);

  itemGroups: { fileId: string; id: number; items: string[] }[] = [];
  isLoading = true;
  error = '';

  ngOnInit(): void {
    this.loadItemIds();
  }

  loadItemIds(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.error = 'Kein Workspace ausgewählt.';
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    this.error = '';

    this.fileService.getItemIdsFromMetadata(workspaceId).subscribe({
      next: groups => {
        this.itemGroups = groups;
        this.isLoading = false;
      },
      error: err => {
        console.error('Failed to load item IDs', err);
        this.error = 'Fehler beim Laden der Item-IDs.';
        this.isLoading = false;
      }
    });
  }

  async openMetadata(group: { fileId: string; id: number; items: string[] }, itemId?: string): Promise<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    const loadingSnackBar = this.snackBar.open('Lade Metadaten...', '', { duration: 3000 });

    try {
      const fileDownload = await firstValueFrom(
        this.fileService.downloadFile(workspaceId, group.id)
      );

      let decodedContent: string;
      try {
        decodedContent = atob(fileDownload.base64Data);
      } catch {
        decodedContent = fileDownload.base64Data;
      }

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

      let itemProfileData = null;
      const firstItem = vomdData.items?.[0];
      const itemProfile = firstItem?.profiles?.[0];

      if (itemProfile) {
        const itemProfileUrl = itemProfile.profileId;
        const itemProfileWithVocabs = await resolver.loadProfileWithVocabularies(itemProfileUrl);
        itemProfileData = itemProfileWithVocabs.profile;
      }

      loadingSnackBar.dismiss();

      let selectedView = 'unit';
      if (itemId) {
        const foundItem = vomdData.items?.find((i: { id: string; uuid?: string }) => i.id === itemId);
        if (foundItem && foundItem.uuid) {
          selectedView = foundItem.uuid;
        } else {
          console.warn(`Could not find UUID for item ID ${itemId}`);
        }
      }

      this.dialog.open(MetadataDialogComponent, {
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
      console.error('Error opening metadata file:', error);
      loadingSnackBar.dismiss();
      this.snackBar.open('Fehler beim Öffnen der Metadaten-Datei.', 'Fehler', { duration: 3000 });
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
