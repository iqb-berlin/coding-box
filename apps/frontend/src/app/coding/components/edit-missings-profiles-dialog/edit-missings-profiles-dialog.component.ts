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
import { TranslateModule } from '@ngx-translate/core';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
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
  missingsProfiles: { label: string }[] = [];
  selectedProfile: MissingsProfilesDto | null = null;
  editMode = false;
  loading = false;
  saving = false;
  displayedColumns: string[] = ['id', 'label', 'description', 'code', 'actions'];

  constructor(
    public dialogRef: MatDialogRef<EditMissingsProfilesDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { workspaceId: number },
    private backendService: BackendService,
    private appService: AppService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadMissingsProfiles();
  }

  loadMissingsProfiles(): void {
    const workspaceId = this.data.workspaceId;
    if (workspaceId) {
      this.loading = true;
      this.backendService.getMissingsProfiles(workspaceId).subscribe({
        next: profiles => {
          this.missingsProfiles = profiles;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.snackBar.open('Error loading missings profiles', 'Close', { duration: 3000 });
        }
      });
    }
  }

  selectProfile(label: string): void {
    const workspaceId = this.data.workspaceId;
    if (workspaceId) {
      this.loading = true;
      this.backendService.getMissingsProfileDetails(workspaceId, label).subscribe({
        next: profile => {
          const missingsProfile = new MissingsProfilesDto();
          if (profile) {
            missingsProfile.id = profile.id;
            missingsProfile.label = profile.label;
            missingsProfile.missings = profile.missings;
          }
          this.selectedProfile = missingsProfile;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.snackBar.open('Error loading missings profile details', 'Close', { duration: 3000 });
        }
      });
    }
  }

  createProfile(): void {
    this.selectedProfile = new MissingsProfilesDto();
    this.selectedProfile.label = '';
    // this.selectedProfile.setMissings([
    //   {
    //     id: 'missing',
    //     label: 'Missing',
    //     description: 'Value is missing',
    //     code: 999
    //   }
    // ]);
    this.editMode = true;
  }

  editProfile(): void {
    this.editMode = true;
  }

  saveProfile(): void {
    const workspaceId = this.data.workspaceId;
    if (workspaceId && this.selectedProfile) {
      this.saving = true;

      const existingProfile = this.missingsProfiles.find(p => p.label === this.selectedProfile?.label);

      if (existingProfile) {
        this.backendService.updateMissingsProfile(workspaceId, existingProfile.label, this.selectedProfile).subscribe({
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
            this.snackBar.open('Profile updated successfully', 'Close', { duration: 3000 });
          },
          error: () => {
            this.saving = false;
            this.snackBar.open('Error updating missings profile', 'Close', { duration: 3000 });
          }
        });
      } else {
        this.backendService.createMissingsProfile(workspaceId, this.selectedProfile).subscribe({
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
      this.backendService.deleteMissingsProfile(workspaceId, this.selectedProfile.label).subscribe({
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
    if (this.selectedProfile) {
      const missings = this.selectedProfile.parseMissings();

      const highestCode = missings.reduce((max, missing) => Math.max(max, missing.code), 0);

      missings.push({
        id: `missing-${Date.now()}`,
        label: 'New Missing',
        description: 'Description',
        code: highestCode > 900 ? highestCode - 1 : 998
      });

      // this.selectedProfile.setMissings(missings);
    }
  }

  removeMissing(index: number): void {
    if (this.selectedProfile) {
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
      return Array.isArray(missings) ? missings : [];
    } catch (error) {
      // Error occurred while parsing missings
      return [];
    }
  }

  updateMissing(index: number, field: keyof MissingDto, value: string | number): void {
    if (this.selectedProfile) {
      const missings = this.selectedProfile.parseMissings();

      if (field === 'code') {
        missings[index][field] = typeof value === 'string' ? parseInt(value, 10) : value;
      } else if (field === 'id' || field === 'label' || field === 'description') {
        missings[index][field] = String(value);
      }

      this.selectedProfile.setMissings(missings);
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
