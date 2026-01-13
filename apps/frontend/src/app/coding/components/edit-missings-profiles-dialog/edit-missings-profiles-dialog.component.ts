import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CodingService } from '../../services/coding.service';
import { AppService } from '../../../core/services/app.service';
import { MissingDto, MissingsProfilesDto } from '../../../../../../../api-dto/coding/missings-profiles.dto';

@Component({
  selector: 'app-edit-missings-profiles-dialog',
  templateUrl: './edit-missings-profiles-dialog.component.html',
  styleUrls: ['./edit-missings-profiles-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    MatSnackBarModule,
    MatTableModule,
    MatTooltipModule,
    TranslateModule
  ]
})
export class EditMissingsProfilesDialogComponent implements OnInit {
  missingsProfiles: { label: string; id: number }[] = [];
  selectedProfile: MissingsProfilesDto | null = null;
  editMode = false;
  loading = false;
  saving = false;
  editMissings: MissingDto[] = [];
  displayedColumns: string[] = ['id', 'label', 'description', 'code', 'actions'];

  constructor(
    public dialogRef: MatDialogRef<EditMissingsProfilesDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { workspaceId: number },
    private codingService: CodingService,
    private appService: AppService,
    private snackBar: MatSnackBar,
    private translateService: TranslateService
  ) { }

  ngOnInit(): void {
    this.loadMissingsProfiles();
  }

  loadMissingsProfiles(): void {
    const workspaceId = this.data.workspaceId;
    if (workspaceId) {
      this.loading = true;
      this.codingService.getMissingsProfiles(workspaceId).subscribe({
        next: profiles => {
          this.missingsProfiles = profiles;
          this.loading = false;
          // Auto-select IQB-Standard profile if it exists
          const iqbStandardProfile = profiles.find(p => p.label === 'IQB-Standard');
          if (iqbStandardProfile) {
            this.selectProfile('IQB-Standard');
          }
        },
        error: () => {
          this.loading = false;
          this.snackBar.open(this.translateService.instant('workspace.error-loading-missings-profiles'), this.translateService.instant('close'), { duration: 3000 });
        }
      });
    }
  }

  selectProfile(label: string): void {
    const workspaceId = this.data.workspaceId;
    if (workspaceId) {
      const profile = this.missingsProfiles.find(p => p.label === label);
      if (profile) {
        this.loading = true;
        this.codingService.getMissingsProfileDetails(workspaceId, profile.id).subscribe({
          next: profileDetails => {
            const missingsProfile = new MissingsProfilesDto();
            if (profileDetails) {
              missingsProfile.id = profileDetails.id;
              missingsProfile.label = profileDetails.label;
              missingsProfile.missings = profileDetails.missings;
            }
            this.selectedProfile = missingsProfile;
            this.loading = false;
          },
          error: () => {
            this.loading = false;
            this.snackBar.open(this.translateService.instant('workspace.error-loading-missings-profile-details'), this.translateService.instant('close'), { duration: 3000 });
          }
        });
      }
    }
  }

  createProfile(): void {
    this.selectedProfile = new MissingsProfilesDto();
    this.selectedProfile.label = '';
    this.selectedProfile.setMissings([]);
    this.editMode = true;
  }

  editProfile(): void {
    if (this.selectedProfile) {
      const missings = this.selectedProfile.parseMissings();
      this.editMissings = Array.isArray(missings) ? [...missings] : [];
    }
    this.editMode = true;
  }

  saveProfile(): void {
    const workspaceId = this.data.workspaceId;
    if (workspaceId && this.selectedProfile) {
      const missings = this.editMode ? this.editMissings : this.selectedProfile.parseMissings();
      if (!this.isProfileValid(missings)) {
        this.snackBar.open(this.translateService.instant('workspace.missing-validation-error'), this.translateService.instant('close'), { duration: 3000 });
        return;
      }

      if (this.editMode) {
        this.selectedProfile.setMissings(missings);
      }

      this.saving = true;

      const existingProfile = this.missingsProfiles.find(p => p.label === this.selectedProfile?.label);

      if (existingProfile) {
        this.codingService.updateMissingsProfile(workspaceId, existingProfile.label, this.selectedProfile).subscribe({
          next: profile => {
            const missingsProfile = new MissingsProfilesDto();
            if (profile) {
              missingsProfile.id = profile.id;
              missingsProfile.label = profile.label;
              missingsProfile.missings = profile.missings;
            }
            this.selectedProfile = missingsProfile;
            this.saving = false;
            this.editMode = false;
            this.loadMissingsProfiles();
            this.snackBar.open(this.translateService.instant('workspace.profile-updated-successfully'), this.translateService.instant('close'), { duration: 3000 });
          },
          error: () => {
            this.saving = false;
            this.snackBar.open('Error updating missings profile', 'Close', { duration: 3000 });
          }
        });
      } else {
        this.codingService.createMissingsProfile(workspaceId, this.selectedProfile).subscribe({
          next: profile => {
            // Convert plain object to MissingsProfilesDto instance
            const missingsProfile = new MissingsProfilesDto();
            if (profile) {
              missingsProfile.id = profile.id;
              missingsProfile.label = profile.label;
              missingsProfile.missings = profile.missings;
            }
            this.selectedProfile = missingsProfile;
            this.saving = false;
            this.editMode = false;
            this.loadMissingsProfiles();
            this.snackBar.open('Profile created successfully', 'Close', { duration: 3000 });
          },
          error: () => {
            this.saving = false;
            this.snackBar.open('Error creating missings profile', 'Close', { duration: 3000 });
          }
        });
      }
    }
  }

  deleteProfile(): void {
    const workspaceId = this.data.workspaceId;
    if (workspaceId && this.selectedProfile) {
      this.saving = true;
      this.codingService.deleteMissingsProfile(workspaceId, this.selectedProfile.label).subscribe({
        next: success => {
          if (success) {
            this.selectedProfile = null;
            this.saving = false;
            this.editMode = false;
            this.loadMissingsProfiles();
            this.snackBar.open('Profile deleted successfully', 'Close', { duration: 3000 });
          } else {
            this.saving = false;
            this.snackBar.open('Error deleting missings profile', 'Close', { duration: 3000 });
          }
        },
        error: () => {
          this.saving = false;
          this.snackBar.open('Error deleting missings profile', 'Close', { duration: 3000 });
        }
      });
    }
  }

  cancelEdit(): void {
    this.editMode = false;

    // If this was a new profile, clear the selection
    if (!this.missingsProfiles.find(p => p.label === this.selectedProfile?.label)) {
      this.selectedProfile = null;
    }
  }

  addMissing(): void {
    const missings = this.editMode ? this.editMissings : (this.selectedProfile?.parseMissings() || []);

    const highestCode = missings.reduce((max, missing) => Math.max(max, missing.code), 0);

    missings.push({
      id: `missing-${Date.now()}`,
      label: 'New Missing',
      description: 'Description',
      code: highestCode > 900 ? highestCode - 1 : 998
    });

    if (this.editMode) {
      this.editMissings = [...missings];
    } else if (this.selectedProfile) {
      this.selectedProfile.setMissings(missings);
    }
  }

  removeMissing(index: number): void {
    if (this.editMode) {
      const missings = [...this.editMissings];
      missings.splice(index, 1);
      this.editMissings = missings;
    } else if (this.selectedProfile) {
      const missings = this.selectedProfile.parseMissings();
      missings.splice(index, 1);
      this.selectedProfile.setMissings(missings);
    }
  }

  getMissings(): MissingDto[] {
    if (!this.selectedProfile) {
      return [];
    }

    try {
      const missings = this.selectedProfile.parseMissings();
      if (!Array.isArray(missings)) {
        return [];
      }
      return missings.filter(missing => missing.id !== undefined && missing.id !== null &&
        missing.id.trim() !== '' && missing.label !== undefined && missing.label !== null &&
        missing.label.trim() !== '' && missing.description !== undefined && missing.description !== null &&
        missing.code !== undefined && missing.code !== null && !Number.isNaN(missing.code));
    } catch (error) {
      // Error occurred while parsing missings
      return [];
    }
  }

  close(): void {
    this.dialogRef.close();
  }

  isProfileValid(missings: MissingDto[]): boolean {
    return missings.every(missing => missing.id !== undefined && missing.id !== null &&
      missing.id.trim() !== '' && missing.label !== undefined && missing.label !== null &&
      missing.label.trim() !== '' && missing.description !== undefined && missing.description !== null &&
      missing.code !== undefined && missing.code !== null && !Number.isNaN(missing.code));
  }
}
