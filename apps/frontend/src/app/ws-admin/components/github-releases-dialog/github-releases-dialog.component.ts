import {
  Component, Inject, OnInit, inject, signal
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FileService, GithubReleaseShort } from '../../../shared/services/file/file.service';

export interface GithubReleasesDialogData {
  workspaceId: number;
}

@Component({
  selector: 'coding-box-github-releases-dialog',
  templateUrl: './github-releases-dialog.component.html',
  styleUrls: ['./github-releases-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatProgressSpinnerModule,
    DatePipe
  ]
})
export class GithubReleasesDialogComponent implements OnInit {
  private fileService = inject(FileService);
  private snackBar = inject(MatSnackBar);
  translate = inject(TranslateService);

  readonly releases = signal<GithubReleaseShort[]>([]);
  readonly isLoading = signal(false);
  displayedColumns = ['name', 'version', 'published_at', 'actions'];
  readonly selectedType = signal<'aspect-player' | 'schemer'>('aspect-player');

  constructor(
    public dialogRef: MatDialogRef<GithubReleasesDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: GithubReleasesDialogData
  ) {}

  ngOnInit(): void {
    this.loadReleases();
  }

  setType(type: 'aspect-player' | 'schemer'): void {
    this.selectedType.set(type);
    this.loadReleases();
  }

  loadReleases(): void {
    this.isLoading.set(true);
    this.fileService.getGithubReleases(this.data.workspaceId, this.selectedType())
      .subscribe({
        next: releases => {
          this.releases.set(releases);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
          this.snackBar.open('Fehler beim Laden der Releases von GitHub.', 'OK', { duration: 3000 });
        }
      });
  }

  install(release: GithubReleaseShort): void {
    this.isLoading.set(true);
    this.fileService.installGithubRelease(this.data.workspaceId, release.url)
      .subscribe({
        next: success => {
          this.isLoading.set(false);
          if (success) {
            this.snackBar.open(`${release.name} erfolgreich installiert.`, 'OK', { duration: 3000 });
            this.dialogRef.close(true);
          } else {
            this.snackBar.open('Installation fehlgeschlagen.', 'OK', { duration: 3000 });
          }
        },
        error: () => {
          this.isLoading.set(false);
          this.snackBar.open('Fehler bei der Installation.', 'OK', { duration: 3000 });
        }
      });
  }

  close(): void {
    this.dialogRef.close();
  }
}
